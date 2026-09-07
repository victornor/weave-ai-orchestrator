import { Hono } from 'hono';
import { z } from 'zod';
import { USAGE_GRAINS, USAGE_WINDOWS } from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { body, query } from '../http.js';

/** An on-demand sync of one runtime, or of every runtime the workspace spends on (VS-84). */
const AccountSyncBody = z.object({ runtimeId: z.string().min(1).optional() });

const UsageQuery = z.object({
  scope: z.string().default('workspace'),
  window: z.enum(USAGE_WINDOWS).default('24h'),
  grain: z.enum(USAGE_GRAINS).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export function usageRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => c.json(c.get('ws').services.usage.series(query(c, UsageQuery))));
  app.get('/top', (c) => {
    const q = query(c, UsageQuery.extend({ by: z.enum(['model', 'ticket', 'role', 'worker', 'project']).default('model') }));
    return c.json(c.get('ws').services.usage.top(q));
  });
  app.get('/models', (c) => c.json(c.get('ws').services.usage.models(query(c, UsageQuery))));
  // The current runtime account snapshots (PLAN §16.2): billing mode and plan limit windows per
  // runtime, each with the display name from the runtime registry and the time it was captured.
  app.get('/accounts', (c) => {
    const ws = c.get('ws');
    return c.json(ws.services.accounts.list().map((a) => ({
      ...a,
      displayName: ws.ctx.registries.runtimes.get(a.runtimeId)?.displayName ?? a.runtimeId,
    })));
  });
  /**
   * Sync the snapshots now (VS-84). One runtime when the body names one, otherwise every runtime
   * this workspace spends on. Rate limited per runtime in the accounts service: a request inside
   * that window is answered, not refused — with the current snapshot and when the next sync of that
   * runtime is allowed — because "too soon" is something the caller has to show, not an error.
   */
  app.post('/accounts/refresh', async (c) => {
    const ws = c.get('ws');
    const { runtimeId } = await body(c, AccountSyncBody);
    const out = await ws.services.accounts.sync(runtimeId ? [runtimeId] : undefined);
    return c.json({
      ...out,
      accounts: out.accounts.map((a) => ({ ...a, displayName: ws.ctx.registries.runtimes.get(a.runtimeId)?.displayName ?? a.runtimeId })),
    });
  });
  /**
   * The credential state per runtime (VS-75): present, when it expires, when it was last verified,
   * when a refresh last failed, and whether a login is needed. Never carries the token — the
   * `RuntimeCredential` shape has nowhere to put one.
   *
   * Composed over the runtimes this workspace actually touches: one that has been probed, and one
   * that has a recorded credential state (a gated runtime may have no account snapshot at all).
   */
  app.get('/credentials', (c) => {
    const ws = c.get('ws');
    const ids = [...new Set([
      ...ws.services.accounts.list().map((a) => a.runtimeId),
      ...ws.services.accounts.credentials().map((x) => x.runtimeId),
    ])].sort();
    return c.json(ids.map((runtimeId) => ({
      ...ws.services.accounts.credential(runtimeId),
      displayName: ws.ctx.registries.runtimes.get(runtimeId)?.displayName ?? runtimeId,
    })));
  });
  app.get('/ticket/:id', (c) => {
    const s = c.get('ws').services;
    return c.json(s.usage.ticket(s.tickets.get(c.req.param('id')).id));
  });
  return app;
}
