import { newId, nowIso } from '@agent-conductor/db';
import { OcError, type Agent, type Run, type Wakeup } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices, Dispatcher } from '../api.js';
import { executeRun } from './engine.js';
import { runState } from './active.js';
import { modelSettingFor, modelsFor } from '../models/resolve.js';
import { flattenWakes } from '../prompts/index.js';

export interface CoreDispatcher extends Dispatcher {
  /** Await every run this dispatcher started (tests and shutdown). */
  drain(): Promise<void>;
}

const IDLE_AGENT_STATUSES = ['active', 'error'];

/**
 * The run a claim is retrying, taken from the wakes it claims. Every producer of a retry — the
 * engine's backoff, the supervisor's boot recovery and its watchdog — puts `retryOfRunId` in the
 * wake payload and nothing else carries it, so claiming is the one place the link can be written.
 * This is the only writer of `runs.retry_of_run_id`; `countRetries` in engine.ts is its only reader,
 * and without it the retry ladder counts zero forever and never ends.
 */
function retryOf(claimed: Wakeup[]): string | null {
  // A wake enqueued while another is already queued is coalesced into it, its payload appended to
  // that wake's `bundle` (wake/index.ts gate 3) — so a retry can arrive either way round.
  const link = (payload: unknown): string | null => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const id = p['retryOfRunId'];
    if (typeof id === 'string' && id) return id;
    const bundle = Array.isArray(p['bundle']) ? (p['bundle'] as Array<Record<string, unknown>>) : [];
    for (let i = bundle.length - 1; i >= 0; i -= 1) {
      const nested = (bundle[i]?.['payload'] ?? {}) as Record<string, unknown>;
      const inner = nested['retryOfRunId'];
      if (typeof inner === 'string' && inner) return inner;
    }
    return null;
  };
  for (let i = claimed.length - 1; i >= 0; i -= 1) {
    const id = link(claimed[i]!.payload);
    if (id) return id;
  }
  return null;
}

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

  /**
   * VS-143: an isolated daemon only dispatches a run a human explicitly asked for — see
   * `daemon-isolation/dispatch-gate`. A wake nobody asked for (a project add's `project_added`, an
   * auto-assignment, a retry, a timer) stays `queued` until a human-requested wake for the same
   * agent — a chat message, answering a decision, anything already enqueued with
   * `requestedBy: { kind: 'human' }` — makes it eligible. Bundled (coalesced) wake-ups carry their
   * own `requestedByKind`, so a human-requested one buried in an otherwise system-requested bundle
   * still counts.
   */
  const isEligibleWhileIsolated = (agentId: string, now: string): boolean => {
    const queued = ctx.db.all<Wakeup>(
      "SELECT * FROM wakeups WHERE agent_id = ? AND status = 'queued' AND (not_before IS NULL OR not_before <= ?)",
      [agentId, now],
    );
    return flattenWakes(queued).some((w) => w.requestedByKind === 'human');
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
      // Queued with what the setting says now; the engine re-reads it at launch and corrects the row
      // if the setting moved between queueing and spawning (VS-77).
      const ticket = agent.ticketId
        ? ctx.db.get<{ workerModelId: string | null }>('SELECT worker_model_id FROM tickets WHERE id = ?', [agent.ticketId])
        : null;
      let setting;
      try {
        setting = modelSettingFor(modelsFor(ctx), agent.kind, ticket);
      } catch (e) {
        if (!(e instanceof OcError) || e.code !== 'model_unconfigured') throw e;
        // Placeholder for the queued row; the engine fails the turn before any runtime starts.
        setting = { runtime: '', model: null };
      }
      ctx.db.insert('runs', {
        id: runId, workspaceId: ctx.workspaceId, agentId: agent.id, ticketId: agent.ticketId,
        wakeupIdsJson: ids, runtimeId: setting.runtime, model: setting.model, status: 'queued',
        turnEpoch: agent.turnEpoch + 1, cwd: agent.homePath, retryOfRunId: retryOf(queued), createdAt: now,
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
        // A runtime whose login has expired is skipped here, before anything is claimed (VS-75):
        // one credential is shared per host, so every turn on it would fail the same way. Filtering
        // at the candidate stage is what preserves the work — the wake-ups stay `queued` rather
        // than being claimed and failed, so nothing has to be re-enqueued when the login returns.
        // A worker whose role is paused is skipped the same way (VS-154): the wake stays queued
        // until roles.resume, rather than being skipped at enqueue and lost.
        const candidates = ctx.db.all<Agent>(
          `SELECT a.* FROM agents a WHERE a.workspace_id = ? AND a.status IN (${IDLE_AGENT_STATUSES.map(() => '?').join(',')})
             AND a.runtime_id NOT IN (SELECT runtime_id FROM runtime_credentials WHERE workspace_id = ? AND needs_login = 1)
             AND (a.kind != 'worker' OR a.role_id IS NULL OR EXISTS (SELECT 1 FROM roles r WHERE r.id = a.role_id AND r.status = 'active'))
             AND EXISTS (SELECT 1 FROM wakeups w WHERE w.agent_id = a.id AND w.status = 'queued' AND (w.not_before IS NULL OR w.not_before <= ?))
           ORDER BY a.kind = 'conductor' DESC, a.last_run_at IS NULL DESC, a.last_run_at`,
          [ctx.workspaceId, ...IDLE_AGENT_STATUSES, ctx.workspaceId, now],
        );
        for (const agent of candidates) {
          if (state.active.size >= max) break;
          if (state.active.has(agent.id)) continue;
          if ([...state.active.values()].some((r) => r.agentId === agent.id)) continue;
          if (runningInDb(agent.id)) continue;
          if (ctx.isolated && !isEligibleWhileIsolated(agent.id, now)) continue;
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

    async stop(timeoutMs?: number): Promise<boolean> {
      state.stopping = true;
      if (timer) { clearInterval(timer); timer = null; }
      if (timeoutMs === undefined) { await dispatcher.drain(); return true; }
      let timedOut = false;
      let handle: NodeJS.Timeout;
      await Promise.race([
        dispatcher.drain(),
        new Promise<void>((r) => { handle = setTimeout(() => { timedOut = true; r(); }, timeoutMs); }),
      ]);
      clearTimeout(handle!);
      return !timedOut;
    },

    async drain(): Promise<void> {
      while (inflight.size) await Promise.allSettled([...inflight]);
    },
  };
  return dispatcher;
}
