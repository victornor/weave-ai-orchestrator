/**
 * `POST /providers/:id/test` (VS-609) — try one configured model provider of the `weave` runtime:
 * the cheap capability probes (models list, a streamed answer, usage, a tool call, which spelling of
 * the output cap the endpoint honours) using the provider's own secret. User-initiated only: nothing
 * calls it on a schedule, and the key never appears in the response.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { OcError, type ProviderProfile } from '@weave-ai/shared';
import type { AppEnv } from '../types.js';
import { body } from '../http.js';

/** The probe as the `weave` runtime package exports it. Loaded by specifier at call time, like the runtime itself (`loadAdapter` in daemon.ts): the server has no build-time dependency on a runtime package. */
export type ProbeFn = (o: { profile: ProviderProfile; model: string; apiKey?: string | undefined }) => Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; detected: Record<string, unknown> }>;
const RUNTIME_PACKAGE = '@weave-ai/runtime-weave';
async function loadProbe(): Promise<ProbeFn> {
  try {
    const mod = (await import(RUNTIME_PACKAGE)) as { probeProvider?: ProbeFn };
    if (mod.probeProvider) return mod.probeProvider;
  } catch { /* fall through */ }
  throw new OcError('unavailable', 'the weave runtime package is not available in this daemon');
}

const TestBodySchema = z.object({ model: z.string().min(1).optional() });

export function providerRoutes(deps: { probe?: ProbeFn } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/:id/test', async (c) => {
    const ws = c.get('ws');
    const id = c.req.param('id');
    const profile = ws.ctx.config.providers?.[id];
    if (!profile) throw new OcError('not_found', `provider ${id} is not configured in this workspace`);
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
