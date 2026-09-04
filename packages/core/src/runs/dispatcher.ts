import { newId, nowIso } from '@agent-conductor/db';
import type { Agent, Run, Wakeup } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices, Dispatcher } from '../api.js';
import { executeRun } from './engine.js';
import { runState } from './active.js';

export interface CoreDispatcher extends Dispatcher {
  /** Await every run this dispatcher started (tests and shutdown). */
  drain(): Promise<void>;
}

const IDLE_AGENT_STATUSES = ['active', 'error'];

/** PLAN §7.2: 1 s tick, one run at a time per agent, caps per host and per project. The DB is authoritative. */
export function createDispatcher(ctx: WorkspaceContext, deps: () => CoreServices): CoreDispatcher {
  const log = ctx.log('run');
  const state = runState(ctx);
  const inflight = new Set<Promise<unknown>>();
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;

  const runningInDb = (agentId: string): boolean =>
    !!ctx.db.get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", [agentId]);

  const projectRunning = (projectId: string): number => {
    let n = 0;
    for (const entry of state.active.values()) {
      const a = ctx.db.get<{ projectId: string | null }>('SELECT project_id FROM agents WHERE id = ?', [entry.agentId]);
      if (a?.projectId === projectId) n += 1;
    }
    return n;
  };

  const claim = (agent: Agent): Run | null => {
    return ctx.db.transaction((): Run | null => {
      const now = nowIso();
      const queued = ctx.db.all<Wakeup>(
        "SELECT * FROM wakeups WHERE agent_id = ? AND status = 'queued' AND (not_before IS NULL OR not_before <= ?) ORDER BY created_at",
        [agent.id, now],
      );
      if (!queued.length) return null;
      const ids = queued.map((w) => w.id);
      for (const id of ids) ctx.db.update('wakeups', id, { status: 'claimed', claimedAt: now });
      const runId = newId();
      ctx.db.insert('runs', {
        id: runId, workspaceId: ctx.workspaceId, agentId: agent.id, ticketId: agent.ticketId,
        wakeupIdsJson: ids, runtimeId: agent.runtimeId, model: agent.model, status: 'queued',
        turnEpoch: agent.turnEpoch + 1, cwd: agent.homePath, createdAt: now,
      });
      for (const id of ids) ctx.db.update('wakeups', id, { runId });
      return ctx.db.get<Run>('SELECT * FROM runs WHERE id = ?', [runId])!;
    });
  };

  const dispatcher: CoreDispatcher = {
    running: () => state.active.size,

    async tick(): Promise<void> {
      if (ticking || state.stopping) return;
      ticking = true;
      try {
        const max = ctx.config.defaults.maxConcurrentRuns ?? 6;
        if (state.active.size >= max) return;
        const now = nowIso();
        const candidates = ctx.db.all<Agent>(
          `SELECT a.* FROM agents a WHERE a.workspace_id = ? AND a.status IN (${IDLE_AGENT_STATUSES.map(() => '?').join(',')})
             AND EXISTS (SELECT 1 FROM wakeups w WHERE w.agent_id = a.id AND w.status = 'queued' AND (w.not_before IS NULL OR w.not_before <= ?))
           ORDER BY a.kind = 'conductor' DESC, a.last_run_at IS NULL DESC, a.last_run_at`,
          [ctx.workspaceId, ...IDLE_AGENT_STATUSES, now],
        );
        for (const agent of candidates) {
          if (state.active.size >= max) break;
          if (state.active.has(agent.id)) continue;
          if ([...state.active.values()].some((r) => r.agentId === agent.id)) continue;
          if (runningInDb(agent.id)) continue;
          if (agent.projectId) {
            const project = ctx.db.get<{ maxWorkers: number }>('SELECT max_workers FROM projects WHERE id = ?', [agent.projectId]);
            if (project && projectRunning(agent.projectId) >= project.maxWorkers) continue;
          }
          const run = claim(agent);
          if (!run) continue;
          state.active.set(run.id, { runId: run.id, agentId: agent.id, startedAt: Date.now(), pid: null, cancel: async () => { /* set once the runtime provides a handle */ } });
          log.info({ agentId: agent.id, runId: run.id, wakeups: run.wakeupIds }, 'run dispatched');
          const p = executeRun(ctx, deps, run.id)
            .catch((e) => {
              log.error({ runId: run.id, err: String(e) }, 'run crashed outside the engine');
              ctx.db.update('runs', run.id, { status: 'failed', finishedAt: nowIso(), errorCode: 'engine_crash', errorFamily: 'unknown', summary: String(e).slice(0, 500) });
              ctx.db.update('agents', agent.id, { status: 'error', errorText: String(e).slice(0, 500), updatedAt: nowIso() });
              state.active.delete(run.id);
            })
            .finally(() => { inflight.delete(p); });
          inflight.add(p);
        }
      } finally {
        ticking = false;
      }
    },

    start(): void {
      if (timer) return;
      state.stopping = false;
      timer = setInterval(() => { void dispatcher.tick(); }, 1000);
      timer.unref?.();
    },

    async stop(): Promise<void> {
      state.stopping = true;
      if (timer) { clearInterval(timer); timer = null; }
      await dispatcher.drain();
    },

    async drain(): Promise<void> {
      while (inflight.size) await Promise.allSettled([...inflight]);
    },
  };
  return dispatcher;
}
