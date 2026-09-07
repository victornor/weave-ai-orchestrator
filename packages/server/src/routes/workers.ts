import { Hono } from 'hono';
import { z } from 'zod';
import { describeLiveInput } from '@agent-conductor/core';
import { TICKET_KINDS } from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { body, csv, query } from '../http.js';

const ListQuery = z.object({ status: csv.optional(), project: z.string().optional(), role: z.string().optional(), includeRetired: z.string().optional() });

export function workerRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const q = query(c, ListQuery);
    const ws = c.get('ws');
    const workers = ws.services.workers.list({ status: q.status as never, projectId: q.project, roleId: q.role, includeRetired: q.includeRetired === 'true' });
    // A worker's own row carries no ticket data; mark which ones are interactive sessions (VS-101)
    // so the list is where they are visible, not only a per-worker detail fetch.
    const ticketIds = [...new Set(workers.map((w) => w.ticketId).filter((id): id is string => Boolean(id)))];
    const interactive = ticketIds.length
      ? new Set(ws.ctx.db.all<{ id: string }>(`SELECT id FROM tickets WHERE interactive_session = 1 AND id IN (${ticketIds.map(() => '?').join(',')})`, ticketIds).map((r) => r.id))
      : new Set<string>();
    return c.json(workers.map((w) => ({ ...w, interactiveSession: w.ticketId ? interactive.has(w.ticketId) : false })));
  });

  app.get('/:id', (c) => {
    const ws = c.get('ws');
    const s = ws.services;
    const worker = s.workers.get(c.req.param('id'));
    const runs = safe(() => s.runs.list({ agentId: worker.id, limit: 1 }));
    return c.json({
      worker,
      ticket: worker.ticketId ? safe(() => s.tickets.get(worker.ticketId!)) : null,
      lastRun: runs?.items[0] ?? null,
      usage: safe(() => s.usage.series({ scope: `worker:${worker.id}`, window: '7d' })),
      // Whether the human's next message right now would reach a running turn (VS-99), so a
      // composer can say so before anyone types rather than guessing from the runtime's name.
      input: safe(() => describeLiveInput(ws.ctx, worker)) ?? { midTurn: false },
      // Whether the worker's *next* turn would resume its existing session rather than start a
      // fresh one — orthogonal to `input.midTurn`, which is about a turn executing right now.
      sessionResumable: safe(() => s.workers.sessionResumable(worker.id)) ?? false,
    });
  });

  // Registered above the `/:id/...` routes per Hono's registration-order matching, though a
  // distinct literal path avoids any real collision with them.
  app.post('/start-session', async (c) => {
    const input = await body(c, z.union([
      z.object({ ticketId: z.string().min(1) }),
      z.object({ projectId: z.string().min(1), roleId: z.string().min(1), kind: z.enum(TICKET_KINDS), title: z.string().min(1), description: z.string().optional() }),
    ]));
    return c.json(await c.get('ws').services.workers.startInteractiveSession(c.get('actor'), input), 201);
  });

  app.get('/:id/brief', (c) => c.text(c.get('ws').services.workers.brief(c.req.param('id'))));

  app.post('/:id/message', async (c) => {
    const { body: text, live } = await body(c, z.object({ body: z.string().min(1), live: z.boolean().optional() }));
    const outcome = await c.get('ws').services.workers.message(c.get('actor'), c.req.param('id'), text, { live });
    return c.json({ delivery: outcome.delivery, runId: outcome.runId, wakeId: outcome.wake?.id ?? null }, 202);
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
  app.post('/:id/purge', async (c) => {
    const { force } = await body(c, z.object({ force: z.boolean().default(false) }));
    const ws = c.get('ws');
    const worker = ws.services.workers.get(c.req.param('id'));
    const result = await ws.services.workers.retireIfLanded(c.get('actor'), worker.id);
    if (result.retired || !force) return c.json({ ...result, id: worker.id });
    // Forced: discard the worktree and cancel the worker (the human decided).
    const row = ws.ctx.db.get<{ id: string; projectId: string; path: string; branch: string; provider: string }>('SELECT * FROM worktrees WHERE agent_id = ? AND status != ? ORDER BY created_at DESC LIMIT 1', [worker.id, 'removed']);
    if (row) {
      const provider = ws.ctx.registries.worktreeProviders.get(row.provider) ?? ws.ctx.registries.worktreeProviders.get('git');
      const project = ws.ctx.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [row.projectId]);
      if (provider && project) { try { await provider.remove({ repoPath: project.clonePath, path: row.path, branch: row.branch, deleteBranch: true, force: true, configPath: ws.ctx.paths.wtConfig }); } catch { /* best effort */ } }
      ws.ctx.db.update('worktrees', row.id, { status: 'removed', removedAt: new Date().toISOString() });
    }
    try { await ws.services.workers.cancel(c.get('actor'), worker.id, 'purged by the human'); } catch { /* already terminal */ }
    const again = await ws.services.workers.retireIfLanded(c.get('actor'), worker.id).catch(() => ({ retired: false, reason: 'forced' }));
    return c.json({ retired: true, forced: true, id: worker.id, detail: again });
  });

  app.post('/:id/resume', (c) => c.json(c.get('ws').services.workers.resume(c.get('actor'), c.req.param('id'))));

  return app;
}

/**
 * `/conductor` lives beside `/workers` in the API but is one agent, not a collection. Its runtime and
 * model are the workspace's conductor model setting — `GET`/`PUT /models` (VS-77), not a patch here.
 */
export function conductorRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  /** Same envelope as `GET /workers/:id`, so one request tells a client which run to stream. */
  app.get('/', (c) => {
    const s = c.get('ws').services;
    const worker = s.workers.conductor();
    const runs = safe(() => s.runs.list({ agentId: worker.id, limit: 1 }));
    return c.json({
      worker,
      ticket: worker.ticketId ? safe(() => s.tickets.get(worker.ticketId!)) : null,
      lastRun: runs?.items[0] ?? null,
      usage: safe(() => s.usage.series({ scope: `worker:${worker.id}`, window: '7d' })),
    });
  });
  app.post('/reset-session', async (c) => {
    const s = c.get('ws').services;
    const { reason } = await body(c, z.object({ reason: z.string().default('reset by operator') }));
    await s.workers.resetSession(c.get('actor'), s.workers.conductor().id, reason);
    return c.json({ ok: true });
  });
  return app;
}

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
