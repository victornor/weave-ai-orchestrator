import { Hono } from 'hono';
import { z } from 'zod';
import { USAGE_GRAINS, USAGE_WINDOWS } from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { query } from '../http.js';

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
  app.get('/ticket/:id', (c) => {
    const s = c.get('ws').services;
    return c.json(s.usage.ticket(s.tickets.get(c.req.param('id')).id));
  });
  return app;
}
