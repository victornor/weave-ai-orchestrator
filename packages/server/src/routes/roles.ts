import { Hono } from 'hono';
import { z } from 'zod';
import { RoleSpecSchema } from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { body } from '../http.js';

export function roleRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => c.json(c.get('ws').services.roles.list(c.req.query('project'))));

  app.get('/:id', (c) => {
    const s = c.get('ws').services;
    const id = c.req.param('id');
    return c.json({
      role: s.roles.get(id), charter: s.roles.charter(id), revisions: s.roles.revisions(id),
      freeSlots: s.roles.freeSlots(id), concurrency: s.roles.concurrency(id), workers: s.workers.list({ roleId: id }),
    });
  });

  app.post('/', async (c) => c.json(await c.get('ws').services.roles.hire(c.get('actor'), await body(c, RoleSpecSchema)), 201));

  // No body: a role carries no runtime or model, so there is nothing to choose here (VS-77).
  app.post('/:id/activate', async (c) => c.json(await c.get('ws').services.roles.activate(c.get('actor'), c.req.param('id'))));

  app.patch('/:id', async (c) => {
    // Strict: an unknown key would otherwise be stripped and the update would report success while
    // changing nothing — the `runtimeId` vs `runtime` mix-up the web app used to ship (VS-32).
    const { patch, reason } = await body(c, z.object({ patch: RoleSpecSchema.partial().strict(), reason: z.string().min(1) }));
    return c.json(await c.get('ws').services.roles.update(c.get('actor'), c.req.param('id'), patch, reason));
  });

  app.put('/:id/charter', async (c) => {
    const i = await body(c, z.object({ charter: z.string().min(1), reason: z.string().min(1), applyToRunning: z.boolean().optional() }));
    return c.json(await c.get('ws').services.roles.updateCharter(c.get('actor'), c.req.param('id'), i.charter, i.reason, { applyToRunning: i.applyToRunning }));
  });

  app.post('/:id/rollback', async (c) => {
    const { revision } = await body(c, z.object({ revision: z.number().int().min(1) }));
    return c.json(await c.get('ws').services.roles.rollback(c.get('actor'), c.req.param('id'), revision));
  });

  app.post('/:id/pause', async (c) => {
    const { reason } = await body(c, z.object({ reason: z.string().min(1) }));
    return c.json(c.get('ws').services.roles.pause(c.get('actor'), c.req.param('id'), reason));
  });
  app.post('/:id/resume', (c) => c.json(c.get('ws').services.roles.resume(c.get('actor'), c.req.param('id'))));
  app.post('/:id/retire', async (c) => {
    const { reason } = await body(c, z.object({ reason: z.string().min(1) }));
    return c.json(await c.get('ws').services.roles.retire(c.get('actor'), c.req.param('id'), reason));
  });

  return app;
}
