/**
 * Provider administration for the built-in `weave` runtime (VS-610):
 * - `GET /providers` — this workspace's configured providers with their profile and whether their
 *   key is held, plus the daemon's preset catalogue. Never a secret value.
 * - `PUT /providers/:id` / `DELETE /providers/:id` — create, replace or remove a profile.
 * - `POST /providers/:id/secret` / `DELETE /providers/:id/secret` — set or clear the profile's API
 *   key in the workspace secret store (the `routes/channels.ts` pattern). The value never appears
 *   in a response, a log line, an event or `workspace.yaml`.
 * - `POST /providers/:id/test` (VS-609) — the on-demand conformance probes.
 *
 * The profile write deliberately does not go through `PATCH /config`: this route returns a resolved
 * view (secret state, model ids, presets) and keeps the key off the config path entirely.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { OcError, ProviderProfileSchema, WorkspaceConfigSchema, type ProviderProfile } from '@weave-ai/shared';
import type { AppEnv, WorkspaceRuntime } from '../types.js';
import { body } from '../http.js';

/** The probe as the `weave` runtime package exports it. Loaded by specifier at call time, like the runtime itself (`loadAdapter` in daemon.ts): the server has no build-time dependency on a runtime package. */
export type ProbeFn = (o: { profile: ProviderProfile; model: string; apiKey?: string | undefined }) => Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; detected: Record<string, unknown> }>;
const RUNTIME_PACKAGE = '@weave-ai/runtime-weave';
interface RuntimeModule { probeProvider?: ProbeFn; PRESET_NAMES?: readonly string[]; loadPreset?: (name: string) => { description?: string } | undefined }
async function loadRuntime(): Promise<RuntimeModule> {
  return (await import(RUNTIME_PACKAGE)) as RuntimeModule;
}
async function loadProbe(): Promise<ProbeFn> {
  try {
    const mod = await loadRuntime();
    if (mod.probeProvider) return mod.probeProvider;
  } catch { /* fall through */ }
  throw new OcError('unavailable', 'the weave runtime package is not available in this daemon');
}

/** A preset the add-a-provider flow can start from. The base URL is a client-side convenience; the daemon owns the id and the description. */
export interface PresetSummary { id: string; description: string }

/**
 * The preset catalogue, or an empty list when the runtime package is unavailable — a workspace with
 * hand-written providers must still list them even if the runtime is missing.
 */
async function presetCatalogue(): Promise<PresetSummary[]> {
  try {
    const mod = await loadRuntime();
    const names = mod.PRESET_NAMES ?? [];
    return names.map((id) => ({ id, description: mod.loadPreset?.(id)?.description ?? '' }));
  } catch {
    return [];
  }
}

/** One configured provider: its profile, whether its key is held, and its model ids. */
export interface ProviderView { id: string; profile: ProviderProfile; secretConfigured: boolean; models: string[] }

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
function providerOf(ws: WorkspaceRuntime, id: string): ProviderProfile {
  const profile = ws.ctx.config.providers?.[id];
  if (!profile) throw new OcError('not_found', `provider ${id} is not configured in this workspace`);
  return profile;
}

const TestBodySchema = z.object({ model: z.string().min(1).optional() });
const SecretBodySchema = z.object({ value: z.string().min(1) });

export function providerRoutes(deps: { probe?: ProbeFn } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const ws = c.get('ws');
    const providers: ProviderView[] = Object.entries(ws.ctx.config.providers ?? {}).map(([id, profile]) => ({
      id,
      profile,
      secretConfigured: Boolean(profile.apiKeySecret && ws.services.secrets.has(profile.apiKeySecret)),
      models: Object.keys(profile.models),
    }));
    return c.json({ providers, presets: await presetCatalogue() });
  });

  app.put('/:id', async (c) => {
    const ws = c.get('ws');
    const id = c.req.param('id');
    if (!ID_PATTERN.test(id)) throw new OcError('validation', `provider id "${id}" must be lower-case kebab-case`);
    const parsed = ProviderProfileSchema.safeParse(await body(c, z.record(z.string(), z.unknown())));
    if (!parsed.success) throw new OcError('validation', `the provider profile for ${id} is invalid`, { issues: parsed.error.issues });
    const merged = WorkspaceConfigSchema.safeParse({ ...ws.ctx.config, providers: { ...ws.ctx.config.providers, [id]: parsed.data } });
    if (!merged.success) throw new OcError('validation', 'the workspace config would be invalid', { issues: merged.error.issues });
    await ws.ctx.saveConfig(merged.data);
    ws.ctx.events.emit('workspace.updated', 'workspace', ws.id, { config: merged.data });
    return c.json({ id, profile: parsed.data, secretConfigured: Boolean(parsed.data.apiKeySecret && ws.services.secrets.has(parsed.data.apiKeySecret)), models: Object.keys(parsed.data.models) });
  });

  app.delete('/:id', async (c) => {
    const ws = c.get('ws');
    const id = c.req.param('id');
    providerOf(ws, id);
    const rest = { ...ws.ctx.config.providers };
    delete rest[id];
    const merged = WorkspaceConfigSchema.safeParse({ ...ws.ctx.config, providers: rest });
    if (!merged.success) throw new OcError('validation', 'the workspace config would be invalid', { issues: merged.error.issues });
    await ws.ctx.saveConfig(merged.data);
    ws.ctx.events.emit('workspace.updated', 'workspace', ws.id, { config: merged.data });
    return c.json({ ok: true });
  });

  app.post('/:id/secret', async (c) => {
    const ws = c.get('ws');
    const id = c.req.param('id');
    const profile = providerOf(ws, id);
    if (!profile.apiKeySecret) throw new OcError('validation', `provider ${id} names no apiKeySecret to hold a key under`);
    const { value } = await body(c, SecretBodySchema);
    ws.services.secrets.put(c.get('actor'), { name: profile.apiKeySecret, envVarName: profile.apiKeySecret, scope: 'workspace' }, value);
    return c.json({ ok: true, configured: true, secretName: profile.apiKeySecret });
  });

  app.delete('/:id/secret', async (c) => {
    const ws = c.get('ws');
    const id = c.req.param('id');
    const profile = providerOf(ws, id);
    if (profile.apiKeySecret) ws.services.secrets.clear(c.get('actor'), profile.apiKeySecret);
    return c.json({ ok: true, configured: false, secretName: profile.apiKeySecret ?? null });
  });

  app.post('/:id/test', async (c) => {
    const ws = c.get('ws');
    const id = c.req.param('id');
    const profile = providerOf(ws, id);
    const { model: asked } = await body(c, TestBodySchema);
    const model = asked ?? Object.keys(profile.models)[0];
    if (!model) throw new OcError('validation', `name a model to test: provider ${id} lists none`);
    const apiKey = profile.apiKeySecret ? ws.services.secrets.value(profile.apiKeySecret) ?? undefined : undefined;
    if (profile.auth !== 'none' && profile.apiKeySecret && !apiKey) {
      return c.json({ ok: false, provider: id, model, checks: [{ name: 'api key', ok: false, detail: `the secret ${profile.apiKeySecret} has no value in this workspace` }], detected: {} });
    }
    const report = await (deps.probe ?? await loadProbe())({ profile, model, apiKey });
    return c.json({ provider: id, model, ...report });
  });

  return app;
}
