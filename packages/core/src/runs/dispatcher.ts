import { newId, nowIso } from '@weave-ai/db';
import { OcError, compactionThreshold, type Agent, type Run, type Wakeup } from '@weave-ai/shared';
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

  /**
   * A session mid-compaction is busy: a turn started now would race the CLI rewriting the same
   * session. Whatever woke the agent stays `queued` and is claimed once compaction clears the flag,
   * which is exactly the "your message is held until the conversation is compacted" behaviour.
   */
  const compactingInDb = (agentId: string): boolean =>
    !!ctx.db.get<{ n: number }>(
      "SELECT 1 AS n FROM agent_sessions WHERE agent_id = ? AND status = 'active' AND compacting_at IS NOT NULL LIMIT 1",
      [agentId],
    );

  // A model's window, cached briefly: a percentage policy needs it, and `modelContextWindow` can spawn
  // a discovery command. Undefined means the runtime cannot state it (OpenCode), so a percentage
  // cannot apply there — only an absolute `tokens` policy does.
  const windowCache = new Map<string, { expires: number; value: Promise<number | undefined> }>();
  const modelWindow = (runtimeId: string, model: string | null): Promise<number | undefined> => {
    const key = `${runtimeId}\u0000${model ?? ''}`;
    const hit = windowCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const adapter = ctx.registries.runtimes.get(runtimeId);
    const value = adapter?.modelContextWindow
      ? Promise.resolve(adapter.modelContextWindow(model)).catch(() => undefined)
      : Promise.resolve(undefined);
    windowCache.set(key, { expires: Date.now() + 300_000, value });
    return value;
  };

  /**
   * Is this agent's automatic compaction policy due — has the last turn's own context size crossed the
   * setting's threshold? If so, start a compaction and report borrowed: the wake stays queued and the
   * `compactingInDb` gate above holds the turn until it finishes. Never throws: a policy that cannot be
   * evaluated (a percentage with no known window, services absent in a test) simply does not fire.
   */
  const compactionDue = async (agent: Agent): Promise<boolean> => {
    try {
      const session = ctx.db.get<{ lastContextTokens: number | null }>(
        "SELECT last_context_tokens AS lastContextTokens FROM agent_sessions WHERE agent_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
        [agent.id],
      );
      const tokens = session?.lastContextTokens;
      if (typeof tokens !== 'number' || tokens <= 0) return false;
      const ticket = agent.ticketId
        ? ctx.db.get<{ workerModelId: string | null }>('SELECT worker_model_id AS workerModelId FROM tickets WHERE id = ?', [agent.ticketId])
        : null;
      const setting = modelSettingFor(modelsFor(ctx), agent.kind, ticket, agent);
      if (!setting.compaction || setting.compaction.mode === 'off') return false;
      const window = setting.compaction.mode === 'percent' ? await modelWindow(setting.runtime, setting.model) : undefined;
      const threshold = compactionThreshold(setting.compaction, window ?? null);
      if (threshold === null || tokens < threshold) return false;
      await deps().workers.compactSession({ kind: 'system', id: null }, agent.id);
      log.info({ agentId: agent.id, tokens, threshold }, 'automatic compaction due; holding the wake until it finishes');
      return true;
    } catch (e) {
      log.warn({ agentId: agent.id, err: String(e) }, 'automatic compaction check skipped');
      return false;
    }
  };

  // VS-495: only a `kind='worker'` agent counts against `project.maxWorkers` — matching the
  // spawn-time gate (`liveInProject` in workers/index.ts and roles/index.ts). A `session`-kind
  // agent (or the weaver/planner) running concurrently in the same project must not compete for,
  // or be throttled by, the project's transient-worker pool.
  const projectRunning = (projectId: string): number => {
    let n = 0;
    for (const entry of state.active.values()) {
      const a = ctx.db.get<{ projectId: string | null; kind: string }>('SELECT project_id, kind FROM agents WHERE id = ?', [entry.agentId]);
      if (a?.projectId === projectId && a.kind === 'worker') n += 1;
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
        setting = modelSettingFor(modelsFor(ctx), agent.kind, ticket, agent);
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
        // VS-375: after a restart, a worker whose turn the shutdown cut off has a preserved queued
        // wake but also a non-null `last_run_at`, so the plain fairness order (`last_run_at IS NULL
        // DESC`) starts brand-new workers first and starves the resumed turns. `resume_rank` lifts
        // them above never-run workers — the weaver still goes first, and everything else keeps the
        // existing order. A worker is resuming when its latest run was recorded `interrupted` by
        // `engine.finalize` with the shutdown code; `COALESCE` keeps that NULL (no run at all) out of
        // the ranking so never-run workers are not pushed last.
        // VS-464: a merge slot holds a whole project's queue, so an admitted merge must not wait behind
        // an ordinary development turn for a free run slot. `merge_rank` lifts an agent carrying a
        // queued `merge_approved` wake — the admission wake or the CI-resolved wake — above workers
        // with a more recent `last_run_at`; the 6-run cap still bounds concurrency, this only decides
        // who takes the next slot that frees. Everything else keeps the existing fairness order.
        const candidates = ctx.db.all<Agent>(
          `SELECT a.*,
                  COALESCE((SELECT CASE WHEN r.status = 'interrupted' AND r.error_code = 'interrupted_by_shutdown'
                                         THEN 1 ELSE 0 END
                              FROM runs r WHERE r.agent_id = a.id
                             ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1), 0) AS resume_rank,
                  COALESCE((SELECT MAX(CASE WHEN w.source = 'merge_approved' THEN 1 ELSE 0 END)
                              FROM wakeups w WHERE w.agent_id = a.id AND w.status = 'queued'
                                AND (w.not_before IS NULL OR w.not_before <= ?)), 0) AS merge_rank
             FROM agents a WHERE a.workspace_id = ? AND a.status IN (${IDLE_AGENT_STATUSES.map(() => '?').join(',')})
             AND a.runtime_id NOT IN (SELECT runtime_id FROM runtime_credentials WHERE workspace_id = ? AND needs_login = 1)
             AND (a.kind != 'worker' OR a.role_id IS NULL OR EXISTS (SELECT 1 FROM roles r WHERE r.id = a.role_id AND r.status = 'active'))
             AND EXISTS (SELECT 1 FROM wakeups w WHERE w.agent_id = a.id AND w.status = 'queued' AND (w.not_before IS NULL OR w.not_before <= ?))
           ORDER BY a.kind = 'weaver' DESC, merge_rank DESC, resume_rank DESC, a.last_run_at IS NULL DESC, a.last_run_at`,
          [now, ctx.workspaceId, ...IDLE_AGENT_STATUSES, ctx.workspaceId, now],
        );
        for (const agent of candidates) {
          if (state.active.size >= max) break;
          if (state.active.has(agent.id)) continue;
          if ([...state.active.values()].some((r) => r.agentId === agent.id)) continue;
          if (runningInDb(agent.id)) continue;
          if (compactingInDb(agent.id)) continue;
          if (await compactionDue(agent)) continue;
          if (ctx.isolated && !isEligibleWhileIsolated(agent.id, now)) continue;
          if (agent.projectId && agent.kind === 'worker') {
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
      // VS-339: a drain that is undone must not leave the workspace permanently marked shut down,
      // or every later failure would be treated as a shutdown cut.
      state.shuttingDown = null;
      timer = setInterval(() => { void dispatcher.tick(); }, 1000);
      timer.unref?.();
    },

    /**
     * VS-339: the shutdown mark. Synchronous by contract — the daemon calls it before its first await
     * in `shutdown()` (and at the top of the HTTP drain), because systemd signals the whole control
     * group, so a runtime child can exit and its turn finalize before an async stop would land.
     */
    beginShutdown(reason: string): void {
      state.shuttingDown = { reason, at: nowIso() };
      state.stopping = true;
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
