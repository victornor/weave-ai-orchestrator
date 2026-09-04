import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types.js';
import { body, csv, query } from '../http.js';

const ListQuery = z.object({ status: csv.optional(), project: z.string().optional(), role: z.string().optional(), includeRetired: z.string().optional() });

export function workerRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const q = query(c, ListQuery);
    return c.json(c.get('ws').services.workers.list({ status: q.status as never, projectId: q.project, roleId: q.role, includeRetired: q.includeRetired === 'true' }));
  });

  app.get('/:id', (c) => {
    const s = c.get('ws').services;
    const worker = s.workers.get(c.req.param('id'));
    const runs = safe(() => s.runs.list({ agentId: worker.id, limit: 1 }));
    return c.json({
      worker,
      ticket: worker.ticketId ? safe(() => s.tickets.get(worker.ticketId!)) : null,
      lastRun: runs?.items[0] ?? null,
      usage: safe(() => s.usage.series({ scope: `worker:${worker.id}`, window: '7d' })),
    });
  });

  app.get('/:id/brief', (c) => c.text(c.get('ws').services.workers.brief(c.req.param('id'))));

  app.post('/:id/message', async (c) => {
    const { body: text } = await body(c, z.object({ body: z.string().min(1) }));
    return c.json(await c.get('ws').services.workers.message(c.get('actor'), c.req.param('id'), text), 202);
  });

  app.post('/:id/relaunch', async (c) => {
    const { note } = await body(c, z.object({ note: z.string().min(1) }));
    return c.json(await c.get('ws').services.workers.relaunch(c.get('actor'), c.req.param('id'), note));
  });

  app.post('/:id/cancel', async (c) => {
    const { reason } = await body(c, z.object({ reason: z.string().min(1) }));
    return c.json(await c.get('ws').services.workers.cancel(c.get('actor'), c.req.param('id'), reason));
  });

  app.post('/:id/pause', async (c) => {
    const { reason } = await body(c, z.object({ reason: z.string().default('paused by operator') }));
    return c.json(c.get('ws').services.workers.pause(c.get('actor'), c.req.param('id'), reason));
  });
  app.post('/:id/resume', (c) => c.json(c.get('ws').services.workers.resume(c.get('actor'), c.req.param('id'))));

  return app;
}

/** `/conductor` lives beside `/workers` in the API but is one agent, not a collection. */
export function conductorRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => c.json(c.get('ws').services.workers.conductor()));
  app.post('/reset-session', async (c) => {
    const s = c.get('ws').services;
    const { reason } = await body(c, z.object({ reason: z.string().default('reset by operator') }));
    await s.workers.resetSession(c.get('actor'), s.workers.conductor().id, reason);
    return c.json({ ok: true });
  });
  app.patch('/', async (c) => {
    const ws = c.get('ws');
    const patch = await body(c, z.object({ runtime: z.string().optional(), model: z.string().nullish(), effort: z.string().optional() }));
    const next = { ...ws.ctx.config, conductor: { ...ws.ctx.config.conductor, ...(patch.runtime ? { runtime: patch.runtime } : {}), ...(patch.model !== undefined ? { model: patch.model ?? null } : {}), ...(patch.effort ? { effort: patch.effort } : {}) } };
    await ws.ctx.saveConfig(next);
    ws.ctx.events.emit('workspace.updated', 'workspace', ws.id, { conductor: next.conductor });
    return c.json(next.conductor);
  });
  return app;
}

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
