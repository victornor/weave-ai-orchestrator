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
 * VS-633: the same handlers serve two scopes. Mounted under `/api/daemon/providers` they administer the
 * daemon's providers and its own secret store (visible to every workspace); mounted per workspace they
 * return the merged view, each entry marked `daemon`, `workspace` or `override`, and write only the
 * workspace's own entries. `POST/DELETE /:id/disable` hides an inherited daemon provider from one workspace.
 *
 * The profile write deliberately does not go through `PATCH /config`: this route returns a resolved
 * view (secret state, model ids, presets) and keeps the key off the config path entirely.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { OcError, ProviderProfileSchema, DaemonConfigSchema, WorkspaceConfigSchema, disabledInherited, type ConfigSource, type ProviderProfile } from '@weave-ai/shared';
import { daemonSecretStore, resolveScopedSecret, scopedProviders, workspaceLoader } from '@weave-ai/core';
import type { Context } from 'hono';
import type { AppDeps, AppEnv } from '../types.js';
import { body } from '../http.js';
import { requireOperator } from '../auth.js';

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

/** One configured provider: its profile, whether its key is held, and its model ids. `source` marks where a workspace's view of it comes from. */
export interface ProviderView { id: string; profile: ProviderProfile; secretConfigured: boolean; models: string[]; source?: ConfigSource }

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** What one scope's provider administration reads and writes. */
interface Scope {
  level: 'daemon' | 'workspace';
  /** This scope's own entries (the daemon's, or the workspace's without the inherited ones). */
  own(): Record<string, ProviderProfile>;
  save(next: Record<string, ProviderProfile>): Promise<void>;
  /** The entries this scope's runs resolve, marked with where each comes from. */
  view(): Array<{ id: string; profile: ProviderProfile; source: ConfigSource }>;
  /** Inherited-but-disabled entries (workspace scope only). */
  disabled(): Array<{ id: string; profile: ProviderProfile }>;
  setDisabled?(next: string[]): Promise<void>;
  disabledIds?(): string[];
  /** Does this scope's run find a value for the secret name (own store, then the daemon's)? */
  secretHeld(name: string): boolean;
  secretValue(name: string): string | null;
  /** The store a key for an entry defined in this scope is written to. */
  putSecret(actor: unknown, name: string, value: string): void;
  clearSecret(actor: unknown, name: string): void;
}

function workspaceScope(c: Context<AppEnv>): Scope {
  const ws = c.get('ws');
  const daemonStore = () => daemonSecretStore(ws.ctx.daemonConfigDir);
  const saveWs = async (next: Record<string, unknown>): Promise<void> => {
    const merged = WorkspaceConfigSchema.safeParse({ ...ws.ctx.config, ...next });
    if (!merged.success) throw new OcError('validation', 'the workspace config would be invalid', { issues: merged.error.issues });
    await ws.ctx.saveConfig(merged.data);
    ws.ctx.events.emit('workspace.updated', 'workspace', ws.id, { config: merged.data });
  };
  return {
    level: 'workspace',
    own: () => ws.ctx.config.providers ?? {},
    save: (providers) => saveWs({ providers }),
    view: () => Object.entries(scopedProviders(ws.ctx)).map(([id, e]) => ({ id, profile: e.value, source: e.source })),
    disabled: () => disabledInherited({ daemon: ws.ctx.daemon?.providers, workspace: ws.ctx.config.providers, disabled: ws.ctx.config.disabledProviders })
      .map((id) => ({ id, profile: ws.ctx.daemon.providers[id]! })),
    setDisabled: (disabledProviders) => saveWs({ disabledProviders }),
    disabledIds: () => ws.ctx.config.disabledProviders ?? [],
    secretHeld: (n) => ws.services.secrets.has(n) || Boolean(daemonStore()?.has(n)),
    secretValue: (n) => resolveScopedSecret((x) => ws.services.secrets.value(x), daemonStore(), n),
    putSecret: (actor, name, value) => ws.services.secrets.put(actor as never, { name, envVarName: name, scope: 'workspace' }, value),
    clearSecret: (actor, name) => ws.services.secrets.clear(actor as never, name),
  };
}

function daemonScope(c: Context<AppEnv>, deps: AppDeps): Scope {
  requireOperator(c);
  const store = () => daemonSecretStore(deps.daemonConfigDir ?? '');
  const needStore = () => { const st = store(); if (!st) throw new OcError('unavailable', 'this daemon has no config directory to hold secrets in'); return st; };
  return {
    level: 'daemon',
    own: () => deps.daemon.providers ?? {},
    async save(providers) {
      deps.daemon.providers = providers;
      if (deps.daemonConfigDir) {
        const current = workspaceLoader.readDaemonConfig(deps.daemonConfigDir);
        workspaceLoader.writeDaemonConfig(DaemonConfigSchema.parse({ ...current, providers }), deps.daemonConfigDir);
      }
    },
    view: () => Object.entries(deps.daemon.providers ?? {}).map(([id, profile]) => ({ id, profile, source: 'daemon' as const })),
    disabled: () => [],
    secretHeld: (n) => Boolean(store()?.has(n)),
    secretValue: (n) => store()?.get(n) ?? null,
    putSecret: (_actor, name, value) => needStore().put(name, value),
    clearSecret: (_actor, name) => store()?.clear(name),
  };
}

const TestBodySchema = z.object({ model: z.string().min(1).optional() });
const SecretBodySchema = z.object({ value: z.string().min(1) });

export function providerRoutes(deps: { probe?: ProbeFn; daemon?: AppDeps } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const scopeOf = (c: Context<AppEnv>): Scope => (deps.daemon ? daemonScope(c, deps.daemon) : workspaceScope(c));
  const viewOf = (scope: Scope, id: string, profile: ProviderProfile, source?: ConfigSource): ProviderView => ({
    id,
    profile,
    secretConfigured: Boolean(profile.apiKeySecret && scope.secretHeld(profile.apiKeySecret)),
    models: Object.keys(profile.models),
    ...(source ? { source } : {}),
  });
  /** A provider this scope can act on: an own entry for writes, anything it resolves for a test. */
  const ownOf = (scope: Scope, id: string): ProviderProfile => {
    const profile = scope.own()[id];
    if (profile) return profile;
    if (scope.view().some((e) => e.id === id)) {
      throw new OcError('validation', `provider ${id} is inherited from the daemon settings; change it there, or override it in this workspace first`);
    }
    throw new OcError('not_found', `provider ${id} is not configured ${scope.level === 'daemon' ? 'in the daemon settings' : 'in this workspace'}`);
  };

  app.get('/', async (c) => {
    const scope = scopeOf(c);
    const providers = scope.view().map((e) => viewOf(scope, e.id, e.profile, e.source));
    const disabled = scope.disabled().map((e) => viewOf(scope, e.id, e.profile, 'daemon'));
    return c.json({ providers, ...(scope.level === 'workspace' ? { disabled } : {}), presets: await presetCatalogue() });
  });

  app.put('/:id', async (c) => {
    const scope = scopeOf(c);
    const id = c.req.param('id');
    if (!ID_PATTERN.test(id)) throw new OcError('validation', `provider id "${id}" must be lower-case kebab-case`);
    const parsed = ProviderProfileSchema.safeParse(await body(c, z.record(z.string(), z.unknown())));
    if (!parsed.success) throw new OcError('validation', `the provider profile for ${id} is invalid`, { issues: parsed.error.issues });
    await scope.save({ ...scope.own(), [id]: parsed.data });
    const source = scope.level === 'daemon' ? 'daemon' : scope.view().find((e) => e.id === id)?.source;
    return c.json(viewOf(scope, id, parsed.data, source));
  });

  app.delete('/:id', async (c) => {
    const scope = scopeOf(c);
    const id = c.req.param('id');
    ownOf(scope, id);
    const rest = { ...scope.own() };
    delete rest[id];
    await scope.save(rest);
    return c.json({ ok: true });
  });

  // Hide an inherited daemon provider from this workspace, or show it again.
  app.post('/:id/disable', async (c) => {
    const scope = scopeOf(c);
    const id = c.req.param('id');
    if (!scope.setDisabled) throw new OcError('validation', 'only a workspace can disable an inherited provider');
    if (scope.own()[id]) throw new OcError('validation', `provider ${id} is this workspace's own; remove it instead`);
    if (!scope.view().some((e) => e.id === id && e.source === 'daemon')) throw new OcError('not_found', `no inherited provider ${id} to disable`);
    await scope.setDisabled([...new Set([...(scope.disabledIds?.() ?? []), id])]);
    return c.json({ ok: true, disabled: true });
  });

  app.delete('/:id/disable', async (c) => {
    const scope = scopeOf(c);
    const id = c.req.param('id');
    if (!scope.setDisabled) throw new OcError('validation', 'only a workspace can disable an inherited provider');
    await scope.setDisabled((scope.disabledIds?.() ?? []).filter((x) => x !== id));
    return c.json({ ok: true, disabled: false });
  });

  app.post('/:id/secret', async (c) => {
    const scope = scopeOf(c);
    const id = c.req.param('id');
    const profile = ownOf(scope, id);
    if (!profile.apiKeySecret) throw new OcError('validation', `provider ${id} names no apiKeySecret to hold a key under`);
    const { value } = await body(c, SecretBodySchema);
    scope.putSecret(c.get('actor'), profile.apiKeySecret, value);
    return c.json({ ok: true, configured: true, secretName: profile.apiKeySecret });
  });

  app.delete('/:id/secret', async (c) => {
    const scope = scopeOf(c);
    const id = c.req.param('id');
    const profile = ownOf(scope, id);
    if (profile.apiKeySecret) scope.clearSecret(c.get('actor'), profile.apiKeySecret);
    return c.json({ ok: true, configured: false, secretName: profile.apiKeySecret ?? null });
  });

  app.post('/:id/test', async (c) => {
    const scope = scopeOf(c);
    const id = c.req.param('id');
    const profile = scope.view().find((e) => e.id === id)?.profile;
    if (!profile) throw new OcError('not_found', `provider ${id} is not configured ${scope.level === 'daemon' ? 'in the daemon settings' : 'in this workspace'}`);
    const { model: asked } = await body(c, TestBodySchema);
    const model = asked ?? Object.keys(profile.models)[0];
    if (!model) throw new OcError('validation', `name a model to test: provider ${id} lists none`);
    const apiKey = profile.apiKeySecret ? scope.secretValue(profile.apiKeySecret) ?? undefined : undefined;
    if (profile.auth !== 'none' && profile.apiKeySecret && !apiKey) {
      return c.json({ ok: false, provider: id, model, checks: [{ name: 'api key', ok: false, detail: `the secret ${profile.apiKeySecret} has no value in ${scope.level === 'daemon' ? 'the daemon settings' : 'this workspace or the daemon settings'}` }], detected: {} });
    }
    const report = await (deps.probe ?? await loadProbe())({ profile, model, apiKey });
    return c.json({ provider: id, model, ...report });
  });

  return app;
}
