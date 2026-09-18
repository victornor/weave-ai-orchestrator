import { Hono } from 'hono';
import { z } from 'zod';
import { describeLiveInput, isWorkerStalled } from '@weave-ai/core';
import { TICKET_KINDS } from '@weave-ai/shared';
import type { AppEnv } from '../types.js';
import { body, csv, query } from '../http.js';
import { scheduledWake } from '../inspect.js';

const ListQuery = z.object({ status: csv.optional(), kind: csv.optional(), project: z.string().optional(), role: z.string().optional(), includeRetired: z.string().optional() });

export function workerRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const q = query(c, ListQuery);
    const ws = c.get('ws');
    // VS-525: `kind` (csv) lets the web app read a role's `session` agents to show whether its chat
    // already exists; omitting it keeps the worker-only list every other caller relies on.
    const workers = ws.services.workers.list({ status: q.status as never, kinds: q.kind as never, projectId: q.project, roleId: q.role, includeRetired: q.includeRetired === 'true' });
    // A worker's own row carries no ticket data; mark which ones are interactive sessions (VS-101)
    // so the list is where they are visible, not only a per-worker detail fetch.
    const ticketIds = [...new Set(workers.map((w) => w.ticketId).filter((id): id is string => Boolean(id)))];
    const interactive = ticketIds.length
      ? new Set(ws.ctx.db.all<{ id: string }>(`SELECT id FROM tickets WHERE interactive_session = 1 AND id IN (${ticketIds.map(() => '?').join(',')})`, ticketIds).map((r) => r.id))
      : new Set<string>();
    // VS-554: the active session's last turn context size, so a surface (the Live floor) can show
    // how full a worker's window is while a new turn is running, when the run itself has no usage yet.
    const agentIds = workers.map((w) => w.id);
    const contextByAgent = new Map<string, number | null>();
    if (agentIds.length) {
      const sessions = ws.ctx.db.all<{ agentId: string; lastContextTokens: number | null }>(
        `SELECT agent_id AS agentId, last_context_tokens AS lastContextTokens FROM agent_sessions
           WHERE status = 'active' AND agent_id IN (${agentIds.map(() => '?').join(',')})
           ORDER BY created_at DESC`,
        agentIds,
      );
      for (const s of sessions) if (!contextByAgent.has(s.agentId)) contextByAgent.set(s.agentId, s.lastContextTokens ?? null);
    }
    return c.json(workers.map((w) => {
      // VS-328: what the worker is doing now and its last test tally, so a fresh board load is correct.
      const activity = ws.services.activity.summaryFor(w.id);
      return {
        ...w,
        interactiveSession: w.ticketId ? interactive.has(w.ticketId) : false,
        // VS-317: a worker waiting on its own scheduled wake is not idle.
        scheduledWake: scheduledWake(ws.services, w.id),
        activity: activity?.activity ?? null,
        tests: activity?.tests ?? null,
        // VS-498: in an active stall/recovery cycle — distinct from `active`, so a board reading this
        // list can tell a stalled worker apart from one genuinely mid-turn.
        stalled: isWorkerStalled(ws.ctx, w.id),
        // VS-554: the last completed turn's context size for this worker, null when it has none yet.
        lastContextTokens: contextByAgent.get(w.id) ?? null,
      };
    }));
  });

  app.get('/:id', (c) => {
    const ws = c.get('ws');
    const s = ws.services;
    const worker = s.workers.get(c.req.param('id'));
    const runs = safe(() => s.runs.list({ agentId: worker.id, limit: 1 }));
    const activity = s.activity.summaryFor(worker.id);
    return c.json({
      worker,
      // VS-553: the worker's role, so a session transcript can name its agent by the role the human
      // recognises. The client's `WorkerDetail.role` already declared and parsed this; the route
      // simply never sent it, so it was always null.
      role: worker.roleId ? safe(() => s.roles.get(worker.roleId!)) : null,
      ticket: worker.ticketId ? safe(() => s.tickets.get(worker.ticketId!)) : null,
      // VS-495: a persistent session's own conversation thread, so a ticketless view knows what to
      // fetch/post against without a second round trip. Null for every other kind.
      thread: worker.kind === 'session' ? (safe(() => s.threads.list({ agentId: worker.id })[0]) ?? null) : null,
      lastRun: runs?.items[0] ?? null,
      usage: safe(() => s.usage.series({ scope: `worker:${worker.id}`, window: '7d' })),
      // VS-328: the same live activity line and last test tally the worker list carries.
      activity: activity?.activity ?? null,
      tests: activity?.tests ?? null,
      // Whether the human's next message right now would reach a running turn (VS-99), so a
      // composer can say so before anyone types rather than guessing from the runtime's name.
      input: safe(() => describeLiveInput(ws.ctx, worker)) ?? { midTurn: false },
      // Whether the worker's *next* turn would resume its existing session rather than start a
      // fresh one — orthogonal to `input.midTurn`, which is about a turn executing right now.
      sessionResumable: safe(() => s.workers.sessionResumable(worker.id)) ?? false,
      // VS-317: the worker's own pending self-wake, so its status view does not read as idle.
      scheduledWake: scheduledWake(s, worker.id),
      // VS-498: in an active stall/recovery cycle — see the workers list for what this means.
      stalled: isWorkerStalled(ws.ctx, worker.id),
      // VS-526: how many turns the current session has taken. A runtime change retires the session
      // (VS-77) and the next turn starts a fresh one at 0, so the surface can say the conversation
      // restarted rather than let it read as lost history. Null for every agent that has no session.
      sessionTurns: worker.kind === 'session' || worker.kind === 'weaver'
        ? (ws.ctx.db.get<{ n: number }>("SELECT turn_count AS n FROM agent_sessions WHERE agent_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", [worker.id])?.n ?? null)
        : null,
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

  /**
   * VS-495: a role's persistent session — no ticket, distinct from `/start-session` above (always
   * ticket-bound). Idempotent: returns the role's existing live session and its thread if it has one.
   */
  app.post('/persistent-session', async (c) => {
    const { projectId, roleId, workerModelId } = await body(c, z.object({
      projectId: z.string().min(1), roleId: z.string().min(1),
      // VS-526: the worker option the session runs on; omitted or null means `models.workers`.
      workerModelId: z.string().min(1).nullish(),
    }));
    const { agent, thread } = await c.get('ws').services.workers.ensureSession(c.get('actor'), projectId, roleId, workerModelId ?? null);
    return c.json({ agent, thread });
  });

  // VS-526: change (or clear) the worker option a persistent session runs on. The caller must have
  // told the human what the change does to the conversation before calling (a runtime change starts
  // a new session on the next turn).
  app.post('/:id/session-option', async (c) => {
    const { workerModelId } = await body(c, z.object({ workerModelId: z.string().min(1).nullable() }));
    return c.json(await c.get('ws').services.workers.setSessionOption(c.get('actor'), c.req.param('id'), workerModelId));
  });

  app.get('/:id/brief', (c) => c.text(c.get('ws').services.workers.brief(c.req.param('id'))));

  app.post('/:id/message', async (c) => {
    const { body: text, live } = await body(c, z.object({ body: z.string().min(1), live: z.boolean().optional() }));
    const outcome = await c.get('ws').services.workers.message(c.get('actor'), c.req.param('id'), text, { live });
    return c.json({ delivery: outcome.delivery, runId: outcome.runId, wakeId: outcome.wake?.id ?? null }, 202);
  });

  app.post('/:id/compact', async (c) => {
    return c.json(await c.get('ws').services.workers.compactSession(c.get('actor'), c.req.param('id')));
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

  // VS-249: read-only, safe to poll — what `POST .../handover` would return without taking anything.
  app.get('/:id/handover-command', (c) => c.json(c.get('ws').services.workers.handoverCommand(c.req.param('id'))));
  app.post('/:id/handover', async (c) => c.json(await c.get('ws').services.workers.startHandover(c.get('actor'), c.req.param('id'))));
  app.post('/:id/handback', async (c) => {
    const { note } = await body(c, z.object({ note: z.string().min(1) }));
    return c.json(await c.get('ws').services.workers.endHandover(c.get('actor'), c.req.param('id'), note));
  });

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
    const session = c.get('ws').ctx.db.get<{ compactingAt: string | null; compactingError: string | null }>(
      "SELECT compacting_at AS compactingAt, compacting_error AS compactingError FROM agent_sessions WHERE agent_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      [worker.id],
    );
    return c.json({
      worker,
      ticket: worker.ticketId ? safe(() => s.tickets.get(worker.ticketId!)) : null,
      lastRun: runs?.items[0] ?? null,
      usage: safe(() => s.usage.series({ scope: `worker:${worker.id}`, window: '7d' })),
      compacting: Boolean(session?.compactingAt),
      compactingError: session?.compactingError ?? null,
    });
  });
  /** The weaver's own compaction — what the chat banner is about. */
  app.post('/compact', async (c) => {
    const s = c.get('ws').services;
    return c.json(await s.workers.compactSession(c.get('actor'), s.workers.conductor().id));
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
