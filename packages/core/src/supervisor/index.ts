import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso } from '@weave-ai/db';
import { WORKER_STATUSES, TERMINAL_TICKET_STATUSES, TICKET_PRIORITIES, SELF_WAKE_STALL_GRACE_MS, type Agent, type KnowledgeScope, type Run, type Ticket } from '@weave-ai/shared';
import type { ForgeAdapter } from '@weave-ai/plugin-sdk';
import { scopeUnitName, stopScope, systemdScopeAvailable } from '@weave-ai/runtime-sdk';
import { formatAge } from '@weave-ai/render';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, Supervisor } from '../api.js';
import { runState } from '../runs/active.js';
import { parkForHuman, runProducedEvidence } from '../runs/engine.js';
import { ungateRuntime } from '../runs/authgate.js';
import { allWorkerStallStates, createWorkerStallState, deleteWorkerStallState, getWorkerStallState, recordEscalation, recordRecoveryAttempt } from './stall-state.js';
import { archivedDirFor } from '../openspec/index.js';
import { CURATION_BUDGET_FRACTION, budgetOf, docSlugOf, isDocPath } from '../knowledge/files.js';
import { sh } from '../util/exec.js';
import { sessionActivitySignal } from '../workers/activity-signal.js';
import { handoverCommentBody, reconcileHandover, type HandoverSnapshot } from '../workers/handover-reconcile.js';
import { sweepScratchWorktrees } from '../tickets/scratch.js';
import { requestedRunnerLabels, runnerGaps } from '../forge/runners.js';

const TICK_MS = 15_000;
const LIVENESS_EVERY_MS = 60_000;
const KILL_AFTER_INTERRUPT_MS = 30_000;
const DAY_MS = 86_400_000;
/** PLAN §13.4: a knowledge file is due for curation 14 days after its last one; ask at most once a day. */
const CURATION_EVERY_MS = 10 * 60_000;
const CURATION_STALE_MS = 14 * DAY_MS;
const CURATION_REQUEST_COOLDOWN_MS = DAY_MS;
/** VS-102: how often the knowledge health view is compared against its last sweep, per workspace/project. */
const KNOWLEDGE_HEALTH_EVERY_MS = 30 * 60_000;
/** A scope's total open issues reaching this many is itself worth telling the conductor about. */
const KNOWLEDGE_HEALTH_ISSUE_THRESHOLD = 5;
/**
 * VS-306: how long an open decision attached to a terminal ticket is left before the stale sweep
 * withdraws it. A day is the smallest round period that guarantees a follow-up asked just after its
 * ticket finished — including one raised late in the day — is still waiting the next morning, so it
 * is readable before it is withdrawn. The two observed near-misses were 52s and 82s after terminal.
 */
const TERMINAL_DECISION_GRACE_MS = DAY_MS;
/** PLAN §7.5 reconciliation is hourly; PLAN §16.1 log retention is a daily sweep. */
const RECONCILE_EVERY_MS = 60 * 60_000;
/**
 * PLAN §16.2: re-read each runtime's plan limits. Zero LLM tokens — one short-lived child process
 * per runtime in use. Five minutes is ≤ 2 % stale against the shortest window that moves (Claude's
 * rolling 5-hour session limit), which is well inside the precision of a percentage.
 */
const ACCOUNTS_EVERY_MS = 5 * 60_000;
/**
 * How often a runtime whose login has expired is re-probed (VS-75). Much faster than the ordinary
 * account poll: while a runtime is gated the whole workspace is stopped on it, so the wait between
 * the owner logging in again and the work resuming is exactly this.
 */
const LOGIN_RECHECK_EVERY_MS = 60_000;
const RETENTION_EVERY_MS = DAY_MS;
/**
 * VS-383: how often stale scratch landing worktrees are reclaimed. Well above any landing's runtime,
 * so a tree still in flight (the in-process set also protects it) is never swept.
 */
const SCRATCH_SWEEP_EVERY_MS = 15 * 60_000;
/**
 * VS-391: how often the active merge's pull request is polled for a check/merge-state transition.
 * Faster than the hourly reconciliation (so a merge turn starts within a supervisor pass of CI
 * finishing) but well short of every 15 s tick, so a deep queue cannot multiply forge calls against
 * GitHub's authenticated rate limit.
 */
const MERGE_POLL_EVERY_MS = 30_000;
/**
 * VS-469: how long a review-carrying approval may stay `unseen` before the weaver is reminded, and the
 * growing wait between reminders. The first fires once the card is older than `FIRST`; the second
 * `SECOND` (the first plus 30 min); every later one a further `EVERY` (60 min). The stage a card is at
 * is derived from its age, so the scan keeps no per-decision state: the wake's own idempotency key
 * `review-reminder:<decisionId>:<stage>` is what stops a repeated scan from stacking reminders.
 */
const REVIEW_REMINDER_FIRST_MS = 10 * 60_000;
const REVIEW_REMINDER_SECOND_MS = 40 * 60_000;
const REVIEW_REMINDER_EVERY_MS = 60 * 60_000;

const SYSTEM: Actor = { kind: 'system', id: null };

/** The backoff stage a card of `ageMs` is due a reminder at, or null before the first one is due. */
function reviewReminderStage(ageMs: number): number | null {
  if (ageMs < REVIEW_REMINDER_FIRST_MS) return null;
  if (ageMs < REVIEW_REMINDER_SECOND_MS) return 0;
  if (ageMs < REVIEW_REMINDER_SECOND_MS + REVIEW_REMINDER_EVERY_MS) return 1;
  return 2 + Math.floor((ageMs - REVIEW_REMINDER_SECOND_MS - REVIEW_REMINDER_EVERY_MS) / REVIEW_REMINDER_EVERY_MS);
}

/**
 * The queue order for tickets waiting on a worker: highest priority first (`TICKET_PRIORITIES`
 * is declared in that order), creation time breaking ties. Interpolated, never parameterised:
 * every value comes from the enum, not from input.
 */
const QUEUE_ORDER_SQL = `CASE priority ${TICKET_PRIORITIES.map((p, i) => `WHEN '${p}' THEN ${i}`).join(' ')} ELSE ${TICKET_PRIORITIES.length} END, created_at`;

const DIGEST_EVENT_TYPES = new Set(['ticket.created', 'project.added', 'ticket.status', 'ticket.merged', 'decision.created', 'decision.expired', 'worker.stalled', 'worker.retired', 'run.finished']);

/**
 * VS-245: the digest carries a finished run's stored report summary into the conductor's wake.
 * `DIGEST_SUMMARY_ENTRY_CHARS` bounds one entry's summary and `DIGEST_SUMMARY_TOTAL_CHARS` bounds
 * the summary text across the whole digest, so a burst of finished runs cannot grow a prompt-bound
 * wake without bound. See `worker-supervision/conductor-digest`.
 */
const DIGEST_SUMMARY_ENTRY_CHARS = 400;
const DIGEST_SUMMARY_TOTAL_CHARS = 1600;
/** VS-469: cap on the digest's list of approvals still awaiting review, like the event entries themselves. */
const DIGEST_PENDING_REVIEW_LIMIT = 10;

/**
 * Hard-bound a stored report summary to `max` characters, including a visible truncation marker.
 * Deliberately not `truncate()` from runtime-sdk: its `[+N chars]` marker is appended past `max`,
 * which would let an entry — and so the digest's total — exceed the ceiling this cap exists to hold.
 */
function capSummaryText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function processAlive(pid: number | null): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** True when some file under the worktree changed inside the silence window (firstmate's write-evidence rule). */
async function worktreeTouchedSince(path: string, since: Date): Promise<boolean> {
  if (!existsSync(path)) return false;
  const stamp = since.toISOString().replace('T', ' ').replace(/\..*$/, '');
  const r = await sh('find', [path, '-not', '-path', '*/.git/*', '-newermt', stamp, '-print', '-quit'], { cwd: path, timeoutMs: 20_000 });
  return r.ok && r.stdout.trim().length > 0;
}

/** PLAN §7.5: daemon-side supervision. Zero LLM tokens; every action is recorded as a supervisor event. */
export function createSupervisor(ctx: WorkspaceContext, deps: () => CoreServices): Supervisor {
  const log = ctx.log('supervisor');
  const state = runState(ctx);
  const interrupted = new Map<string, number>();
  const retried = new Set<string>();
  const spawnWaitSince = new Map<string, number>();
  /** VS-202: agentId -> the `last_run_at` value already raised as stalled, so a still-stalled worker is not re-notified every sweep. */
  const stalledNotified = new Map<string, string>();
  /**
   * VS-467: ticketId -> when its stalled-check alarm was last raised, so a merge-slot holder stuck on
   * unresolved checks alarms at the `mergeChecksAlarmSec` cadence, not on every merge poll. An entry
   * is dropped as soon as the checks resolve or the ticket leaves the merge step.
   */
  const mergeChecksAlarmedAt = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;
  let bootRecovered = false;
  let lastLiveness = 0;
  let lastDigestAt = 0;

  const meta = (key: string): string | null => ctx.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null;
  const setMeta = (key: string, value: string): void => { ctx.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]); };

  /** True at most once per `everyMs`, and the last run is persisted so a restart does not re-run immediately. */
  /**
   * Re-probe every gated runtime and release the workspace when its credential works again (VS-75).
   *
   * Success is a `describeAccount` that reports a billing type other than `unknown`. That is
   * deliberately conservative: `unknown` also covers a missing binary and a probe that timed out,
   * and treating either as recovery would un-gate straight into a second outage.
   *
   * The cheap pre-check first: if the credential file's expiry has not moved since the refresh
   * failed, nobody has logged in yet and there is nothing to probe.
   */
  async function loginRecheck(): Promise<void> {
    const gated = deps().accounts.gatedRuntimes();
    for (const runtimeId of gated) {
      const before = deps().accounts.credential(runtimeId);
      if (!before.present) continue;                       // nothing to probe: the credential is gone entirely
      if (before.expiresAt !== null && before.refreshFailedAt !== null && before.expiresAt <= before.refreshFailedAt) continue;
      const [described] = await deps().accounts.refresh([runtimeId]);
      if (described && described.billingType !== 'unknown') ungateRuntime(ctx, deps, runtimeId);
    }
  }

  const due = (key: string, everyMs: number): boolean => {
    const last = Number(meta(key) ?? 0);
    if (Number.isFinite(last) && last > 0 && Date.now() - last < everyMs) return false;
    setMeta(key, String(Date.now()));
    return true;
  };

  const supervisorEvent = (runId: string, action: string, detail: Record<string, unknown>): void => {
    const seq = (ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(seq),0) n FROM run_events WHERE run_id = ?', [runId])?.n ?? 0) + 1;
    ctx.db.run('INSERT INTO run_events (run_id, seq, ts, type, stream, level, payload_json) VALUES (?,?,?,?,?,?,?)', [runId, seq, nowIso(), 'supervisor.action', 'system', 'warn', JSON.stringify({ action, ...detail })]);
  };

  /**
   * VS-636: a worker whose creation a drain or restart cut off keeps its row and its ticket binding
   * but never got a worktree; `spawnPending` only acts on tickets with no worker, so nothing else
   * resumes it and a relaunch would leave it active with a null path. Provision every such worker on
   * boot. The workers service owns creation and idempotency, so a healthy worker is left untouched.
   */
  async function reprovisionMissingWorktrees(): Promise<void> {
    const rows = ctx.db.all<{ id: string; worktreePath: string | null }>(
      `SELECT id, worktree_path AS worktreePath FROM agents
        WHERE workspace_id = ? AND kind IN ('worker','session') AND branch IS NOT NULL
          AND status IN ('provisioning','active')`,
      [ctx.workspaceId],
    );
    for (const row of rows) {
      if (row.worktreePath && existsSync(row.worktreePath)) continue;
      try {
        await deps().workers.ensureWorktree(row.id);
      } catch (e) {
        log.warn({ agentId: row.id, err: String(e) }, 'boot sweep could not provision a missing worktree');
      }
    }
  }

  async function bootRecovery(): Promise<void> {
    const running = ctx.db.all<Run>("SELECT * FROM runs WHERE workspace_id = ? AND status = 'running'", [ctx.workspaceId]);
    for (const run of running) {
      if (state.active.has(run.id)) continue;
      // VS-579: a worker turn lives in its own transient scope, a sibling of this unit rather than a
      // child — so a daemon restart does NOT take it down the way it used to. Stop the orphaned scope
      // first; the pgid kill below is the fallback for an uncontained spawn.
      if (systemdScopeAvailable()) stopScope(scopeUnitName(run.id));
      // A run that is still 'running' at boot belonged to a dead daemon: its process (if alive) is an unsupervised orphan. Kill the group, then recover.
      if (processAlive(run.pid)) {
        const target = run.pgid ?? run.pid;
        try { process.kill(-(target as number), 'SIGTERM'); } catch { try { process.kill(run.pid as number, 'SIGTERM'); } catch { /* gone */ } }
        setTimeout(() => { try { process.kill(-(target as number), 'SIGKILL'); } catch { try { process.kill(run.pid as number, 'SIGKILL'); } catch { /* gone */ } } }, 10_000).unref();
        log.warn({ runId: run.id, pid: run.pid, pgid: run.pgid }, 'killed an orphaned run process left by the previous daemon');
      }
      log.warn({ runId: run.id, agentId: run.agentId }, 'run was interrupted by a daemon restart');
      ctx.db.update('runs', run.id, { status: 'interrupted', finishedAt: nowIso(), errorCode: 'interrupted', errorFamily: 'tooling' });
      ctx.db.run("UPDATE wakeups SET status = 'failed', finished_at = ? WHERE run_id = ? AND status IN ('claimed','queued')", [nowIso(), run.id]);
      ctx.db.update('agents', run.agentId, { status: 'active', updatedAt: nowIso() });
      // VS-667: the restart changed this worker's live-readiness; the other resume paths all emit a
      // `worker.status: active`, so the rail's Live badge drops it from its own event rather than
      // waiting for another read to happen to refresh.
      ctx.events.emit('worker.status', 'agent', run.agentId, { status: 'active' });
      // VS-625: the restart has put this worker back to work; a card that still says it is stopped
      // is stale, so close it before the re-queued turn is claimed. Best effort: recovery stands.
      try {
        deps().decisions.supersedeWorkerStopCards({ kind: 'system', id: null }, run.agentId, `the worker was resumed after a daemon restart at ${nowIso()}`);
      } catch (e) { log.warn({ runId: run.id, agentId: run.agentId, err: String(e) }, 'closing a recovered worker\'s stop cards failed'); }
      supervisorEvent(run.id, 'boot_recovery', { previousStatus: 'running' });
      try {
        deps().wake.enqueue(run.agentId, { source: 'retry', reason: 'previous turn was interrupted', payload: { retryOfRunId: run.id, interrupted: true }, idempotencyKey: `boot-retry:${run.id}`, requestedBy: { kind: 'system', id: null } });
      } catch (e) { log.warn({ err: String(e) }, 'could not re-queue the interrupted run'); }
    }
  }

  /**
   * VS-383: reclaim scratch landing worktrees a failed or interrupted landing left behind. A daemon
   * killed mid-landing skips its `finally`, and before VS-383 a refused checkout leaked the tree with
   * no handle at all — on a RAM-backed `/tmp` that is real memory. Runs once at boot and on a period.
   */
  async function sweepScratch(): Promise<void> {
    const clones = deps().projects.list().map((p) => ({ clonePath: p.clonePath, slug: p.slug }));
    if (clones.length === 0) return;
    const { removed, bytes } = await sweepScratchWorktrees({ clones, stateDir: ctx.paths.state });
    if (removed.length > 0) log.info({ removed: removed.length, bytes, paths: removed.map((r) => r.path) }, 'swept stale scratch worktrees');
  }

  /** VS-461: did this run record any event that shows progress, or only the turn start? */
  function runProgressed(run: Run): boolean {
    const p = run.lastProgressAt ? Date.parse(run.lastProgressAt) : NaN;
    const s = Date.parse(run.startedAt ?? run.createdAt);
    return Number.isFinite(p) && Number.isFinite(s) && p - s > 1_000;
  }

  /** VS-461: was this run interrupted by the watchdog for silence (its own `silence_interrupt` event)? */
  function wasSilenceInterrupted(runId: string): boolean {
    return Boolean(ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) n FROM run_events WHERE run_id = ? AND type = 'supervisor.action' AND payload_json LIKE '%\"action\":\"silence_interrupt\"%'",
      [runId],
    )?.n);
  }

  /** The run this one followed for the same agent, if any. */
  function previousFinishedRun(agentId: string, runId: string): Run | null {
    return ctx.db.get<Run>(
      'SELECT * FROM runs WHERE agent_id = ? AND id != ? AND finished_at IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1',
      [agentId, runId],
    ) ?? null;
  }

  async function watchdog(): Promise<void> {
    const silenceMs = (ctx.config.defaults.silenceTimeoutSec ?? 600) * 1000;
    const timeoutMs = (ctx.config.defaults.turnTimeoutSec ?? 2700) * 1000;
    const running = ctx.db.all<Run>("SELECT * FROM runs WHERE workspace_id = ? AND status = 'running'", [ctx.workspaceId]);
    for (const run of running) {
      const startedAt = new Date(run.startedAt ?? run.createdAt).getTime();
      // VS-461: silence is measured from the last *progress* event (`isProgressRunEvent`), not the
      // last event of any kind. A provider that accepts a request and never starts it keeps the
      // runtime's retry loop re-emitting session/step-boundary events, which used to reset this clock
      // without any work being done. Rows written before the column existed fall back to the last
      // event and then the turn start.
      const lastProgressAt = new Date(run.lastProgressAt ?? run.lastEventAt ?? run.startedAt ?? run.createdAt).getTime();
      const now = Date.now();
      const hardTimedOut = now - startedAt > timeoutMs;
      const silent = now - lastProgressAt > silenceMs;
      if (!hardTimedOut && !silent) { interrupted.delete(run.id); continue; }

      if (silent && !hardTimedOut) {
        const agent = ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [run.agentId]);
        if (agent?.worktreePath && await worktreeTouchedSince(agent.worktreePath, new Date(now - silenceMs))) {
          log.debug({ runId: run.id }, 'silence deferred: the worktree is still being written to');
          continue;
        }
      }

      const entry = state.active.get(run.id);
      const firstAt = interrupted.get(run.id);
      if (!firstAt) {
        interrupted.set(run.id, now);
        // VS-461: the run's own last upstream error travels with the alarm, so the conductor sees
        // *why* the turn went quiet, not only that it did.
        const lastError = run.lastError ?? null;
        supervisorEvent(run.id, hardTimedOut ? 'hard_timeout_interrupt' : 'silence_interrupt', { silentMs: now - lastProgressAt, lastError });
        ctx.events.emit('worker.stalled', 'agent', run.agentId, { runId: run.id, reason: hardTimedOut ? 'hard timeout' : 'silence', lastError });
        log.warn({ runId: run.id, agentId: run.agentId, hardTimedOut, lastError }, 'interrupting a stuck run');
        // VS-461: one automatic resume of a no-progress silence cut is allowed; a second consecutive
        // one is not — the same upstream error will not clear by spending a third turn. Park the
        // worker with the provider's own words, and suppress the watchdog's retry wake below.
        const prior = previousFinishedRun(run.agentId, run.id);
        if (!hardTimedOut && !runProgressed(run) && prior && !runProgressed(prior) && wasSilenceInterrupted(prior.id)) {
          const stalled = ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [run.agentId]);
          if (stalled) {
            retried.add(run.id);
            supervisorEvent(run.id, 'park_after_repeated_silence', { priorRunId: prior.id, lastError });
            parkForHuman(
              ctx, deps, { run: { id: run.id, runtimeId: run.runtimeId }, agent: stalled },
              'tooling', 'repeated_provider_no_progress',
              lastError ?? 'the runtime made no progress across two consecutive turns',
            );
          }
        }
        try { if (entry) { entry.cancelled = { mode: 'interrupt' }; await entry.cancel('interrupt'); } } catch { /* already gone */ }
        continue;
      }
      if (now - firstAt < KILL_AFTER_INTERRUPT_MS) continue;

      supervisorEvent(run.id, 'kill', { afterMs: now - firstAt });
      try { if (entry) { entry.cancelled = { mode: 'kill' }; await entry.cancel('kill'); } } catch { /* already gone */ }
      interrupted.delete(run.id);
      if (!entry) {
        // Nothing in this process owns the run: close it out here.
        ctx.db.update('runs', run.id, { status: hardTimedOut ? 'timed_out' : 'failed', finishedAt: nowIso(), errorCode: hardTimedOut ? 'timeout' : 'silence', errorFamily: 'tooling' });
        ctx.db.run("UPDATE wakeups SET status = 'failed', finished_at = ? WHERE run_id = ?", [nowIso(), run.id]);
        ctx.db.update('agents', run.agentId, { status: 'active', updatedAt: nowIso() });
        // VS-667: the watchdog put this worker back to work, so its live-readiness changed with no
        // other event; emit the status the other resume paths emit.
        ctx.events.emit('worker.status', 'agent', run.agentId, { status: 'active' });
      }
      if (!retried.has(run.id)) {
        retried.add(run.id);
        try {
          deps().wake.enqueue(run.agentId, { source: 'retry', reason: hardTimedOut ? 'previous turn timed out' : 'previous turn stopped responding', payload: { retryOfRunId: run.id }, idempotencyKey: `watchdog-retry:${run.id}`, requestedBy: { kind: 'system', id: null } });
        } catch { /* the wake queue will be retried next tick */ }
      }
    }
  }

  function liveWorkerFor(ticketId: string): Agent | null {
    return ctx.db.get<Agent>("SELECT * FROM agents WHERE ticket_id = ? AND kind = 'worker' AND status NOT IN ('retired','done') LIMIT 1", [ticketId]) ?? null;
  }

  async function spawnPending(): Promise<void> {
    const statuses = WORKER_STATUSES.map(() => '?').join(',');
    // A ticket waiting in the merge queue needs no worker until the queue admits it (PLAN §11.4);
    // the queue brings one itself at that moment, so spawning here would only burn a role slot.
    const tickets = ctx.db.all<Ticket>(
      `SELECT * FROM tickets WHERE workspace_id = ? AND status IN (${statuses}) AND assignee_role_id IS NOT NULL AND worker_id IS NULL
         AND NOT (status = 'merging' AND merge_started_at IS NULL) ORDER BY ${QUEUE_ORDER_SQL}`,
      [ctx.workspaceId, ...WORKER_STATUSES],
    );
    for (const ticket of tickets) {
      if (liveWorkerFor(ticket.id)) continue;
      const role = ctx.db.get<{ id: string; status: string; name: string }>('SELECT id, status, name FROM roles WHERE id = ?', [ticket.assigneeRoleId!]);
      if (!role || role.status !== 'active') continue;
      try {
        await deps().workers.spawnForTicket({ kind: 'system', id: null }, ticket.id);
        spawnWaitSince.delete(ticket.id);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'role_full') {
          const since = spawnWaitSince.get(ticket.id) ?? Date.now();
          spawnWaitSince.set(ticket.id, since);
          const waitedSec = (Date.now() - since) / 1000;
          if (waitedSec > (ctx.config.defaults.spawnWaitWarnSec ?? 600)) {
            spawnWaitSince.set(ticket.id, Date.now());
            log.warn({ ticket: ticket.identifier, role: role.name }, 'ticket has waited for a worker slot');
            try {
              const conductor = deps().workers.conductor();
              deps().wake.enqueue(conductor.id, { source: 'system', reason: `${ticket.identifier} has been waiting ${Math.round(waitedSec / 60)} min for a free ${role.name} slot`, payload: { ticketId: ticket.id, kind: 'spawn_wait' }, requestedBy: { kind: 'system', id: null } });
            } catch { /* no conductor yet */ }
          }
        } else {
          log.error({ ticket: ticket.identifier, err: String(e) }, 'spawn failed');
        }
      }
    }
  }

  async function retireFinished(): Promise<void> {
    const workers = ctx.db.all<Agent>("SELECT * FROM agents WHERE workspace_id = ? AND kind = 'worker' AND status IN ('active','done','error') AND ticket_id IS NOT NULL", [ctx.workspaceId]);
    for (const w of workers) {
      const ticket = ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [w.ticketId!]);
      if (!ticket || !TERMINAL_TICKET_STATUSES.includes(ticket.status)) continue;
      const running = ctx.db.get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", [w.id]);
      if (running) continue;
      try {
        const r = await deps().workers.retireIfLanded({ kind: 'system', id: null }, w.id);
        if (!r.retired) {
          log.debug({ workerId: w.id, reason: r.reason }, 'worker kept: work has not landed');
          // VS-172: a terminal ticket's worker must not stay live even when land refuses.
          if (w.status !== 'done') {
            try { deps().wake.cancelForAgent(w.id, r.reason ?? 'ticket terminal, work has not landed'); }
            catch (e) { log.warn({ workerId: w.id, err: String(e) }, 'cancelling wakes after a refused retire failed'); }
            ctx.db.update('agents', w.id, { status: 'done', updatedAt: nowIso() });
            ctx.db.run("UPDATE worktrees SET status = 'dirty' WHERE agent_id = ? AND status = 'active'", [w.id]);
            ctx.events.emit('worker.status', 'agent', w.id, { status: 'done', reason: r.reason });
          }
        }
      } catch (e) { log.warn({ workerId: w.id, err: String(e) }, 'retire attempt failed'); }
    }
  }

  /**
   * Cancel an interactive session's worker (VS-101) that has had no turn run and none executing for
   * the configured quiet period — the same `workers.cancel` a human ending it would call, so the
   * ticket is left commented and the worktree kept, never discarded. `agents.lastRunAt` is stamped at
   * every turn's finalize (both a human's message and the agent's own activity lead to one), so no
   * separate activity timestamp is needed.
   */
  async function retireIdleSessions(): Promise<void> {
    const timeoutMs = (ctx.config.defaults.interactiveSessionIdleTimeoutMinutes ?? 240) * 60_000;
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    const idle = ctx.db.all<Agent>(
      `SELECT a.* FROM agents a JOIN tickets t ON t.id = a.ticket_id
        WHERE a.workspace_id = ? AND a.kind = 'worker' AND a.status IN ('provisioning','active','running','paused','error') AND t.interactive_session = 1
          AND (a.last_run_at IS NULL OR a.last_run_at < ?)`,
      [ctx.workspaceId, cutoff],
    );
    for (const agent of idle) {
      const running = ctx.db.get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", [agent.id]);
      if (running) continue;
      try {
        await deps().workers.cancel(SYSTEM, agent.id, 'idle interactive session');
        log.info({ agentId: agent.id, ticketId: agent.ticketId }, 'interactive session cancelled: idle');
      } catch (e) { log.warn({ agentId: agent.id, err: String(e) }, 'idle session cancel failed'); }
    }
  }

  /**
   * VS-249: closes a hold nobody gave back — but only once it has gone quiet, not merely once it is
   * old (`session-handover/lease`). Every open hold's activity signal is re-sampled each tick; a
   * change updates the row and defers closing regardless of elapsed time. A hold closes only once it
   * is both older than `handoverAbandonTimeoutMinutes` and has shown no signal change for
   * `handoverQuietMinutes`, using the same reconciliation `endHandover` uses.
   */
  async function reconcileAbandonedHandovers(): Promise<void> {
    const abandonMinutes = ctx.config.defaults.handoverAbandonTimeoutMinutes ?? 120;
    const quietMinutes = ctx.config.defaults.handoverQuietMinutes ?? 30;
    const open = ctx.db.all<{
      id: string; agentId: string; ticketId: string | null; runtimeId: string; worktreeHead: string | null;
      lastActivitySignal: string | null; lastActivityAt: string; startedAt: string;
    }>("SELECT * FROM agent_handovers WHERE status = 'active'");
    const now = Date.now();

    for (const hold of open) {
      const agent = ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [hold.agentId]);
      if (!agent) continue;
      const configHome = join(ctx.paths.runtimesHome, hold.runtimeId);
      const signalNow = sessionActivitySignal(configHome);
      if (signalNow !== hold.lastActivitySignal) {
        const at = nowIso();
        ctx.db.update('agent_handovers', hold.id, { lastActivitySignal: signalNow, lastActivityAt: at, updatedAt: at });
        continue;
      }
      if (now - Date.parse(hold.startedAt) < abandonMinutes * 60_000) continue;
      if (now - Date.parse(hold.lastActivityAt) < quietMinutes * 60_000) continue;

      const snapshot: HandoverSnapshot = { worktreeHead: hold.worktreeHead, runtimeId: hold.runtimeId, lastActivitySignal: hold.lastActivitySignal, startedAt: hold.startedAt };
      try {
        const reconciliation = await reconcileHandover(ctx, agent, snapshot);
        const finishedAt = nowIso();
        const everActive = hold.lastActivitySignal !== null;
        const note = everActive
          ? `recovered automatically after activity stopped; last session activity observed at ${hold.lastActivityAt}, ${quietMinutes} min of quiet since`
          : `recovered automatically after ${abandonMinutes} min; no session activity was ever detected`;
        ctx.db.update('agent_handovers', hold.id, { status: 'abandoned', returnedAt: finishedAt, note, reconciliationJson: reconciliation, updatedAt: finishedAt });
        ctx.db.update('agents', hold.agentId, { status: 'active', pauseReason: null, pauseDetailJson: null, updatedAt: finishedAt });
        if (agent.ticketId) {
          try { deps().tickets.comment(SYSTEM, agent.ticketId, handoverCommentBody(agent, reconciliation, note, true), 'status', 'trusted'); }
          catch (e) { log.warn({ agentId: agent.id, err: String(e) }, 'posting the abandoned-handover comment failed'); }
        }
        try {
          deps().wake.enqueue(hold.agentId, {
            source: 'system', reason: 'session handed back automatically after being abandoned',
            payload: { handedBack: true, abandoned: true }, idempotencyKey: `handback:${hold.agentId}:${agent.turnEpoch}`, requestedBy: SYSTEM,
          });
        } catch (e) { log.error({ agentId: agent.id, err: String(e) }, 'recovering the abandoned hold could not queue its next turn'); }
        log.info({ agentId: agent.id, holdId: hold.id }, 'abandoned handover closed automatically');
      } catch (e) { log.warn({ agentId: agent.id, err: String(e) }, 'closing an abandoned handover failed'); }
    }
  }

  /**
   * Advance every project's merge queue (PLAN §11.4). Transitions pump their own project, so this is
   * the recovery path: a queue whose head vanished with the daemon, or one left half-admitted by a
   * restart, starts moving again on the next tick without anyone acting.
   */
  async function pumpMergeQueues(): Promise<void> {
    const queue = deps().tickets.mergeQueue;
    if (!queue) return;
    await queue.pumpAll();
  }

  /** VS-653: whether an agent's two most recent runs both ended empty (an `empty_turn` failure or an `empty` success). */
  function lastTurnsEmpty(agentId: string): boolean {
    const recent = ctx.db.all<{ liveness: string; errorCode: string | null }>(
      "SELECT liveness, error_code AS errorCode FROM runs WHERE agent_id = ? AND status IN ('succeeded', 'failed') ORDER BY created_at DESC, rowid DESC LIMIT 2",
      [agentId],
    );
    return recent.length === 2 && recent.every((r) => r.liveness === 'empty' || r.errorCode === 'empty_turn');
  }

  function livenessScan(): void {
    let violations: Ticket[] = [];
    try { violations = deps().tickets.livenessViolations(); } catch { return; }
    for (const ticket of violations) {
      const worker = ticket.workerId ? ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [ticket.workerId]) : liveWorkerFor(ticket.id);
      if (worker && lastTurnsEmpty(worker.id)) {
        // VS-653: two empty turns in a row mean the worker cannot act (no tools, no report path);
        // another repair wake only repeats them. A human comment, an answer or steering wakes it.
        log.warn({ ticket: ticket.identifier, agentId: worker.id }, 'liveness repair withheld: the worker\'s last turns were empty');
        continue;
      }
      if (worker) {
        try {
          deps().wake.enqueue(worker.id, { source: 'system', reason: 'liveness_repair', payload: { ticketId: ticket.id }, idempotencyKey: `liveness:${ticket.id}:${ticket.status}`, requestedBy: { kind: 'system', id: null } });
        } catch { /* next scan will try again */ }
      } else {
        log.warn({ ticket: ticket.identifier, status: ticket.status }, 'liveness violation with no live worker');
      }
    }
  }

  /**
   * `proposed` and `in_review` are deliberately outside `LIVENESS_STATUSES` (an open decision is
   * their action path), but that means a ticket left with none open — VS-104: an overloaded document
   * key silently closed one — is invisible to `livenessScan`. `repairApprovals` raises a fresh
   * approval for any such ticket; this tells the conductor it happened, naming every ticket in one
   * wake, the same as `knowledgeHealthPass` and the spawn-wait nudge.
   */
  async function approvalIntegrityScan(): Promise<void> {
    let repaired: Array<{ id: string; identifier: string; kind: 'plan_approval' | 'merge_approval' | 'action_approval' }> = [];
    try { repaired = await deps().tickets.repairApprovals(); } catch (e) { log.error({ err: String(e) }, 'approval integrity scan failed'); return; }
    if (!repaired.length) return;
    for (const r of repaired) log.warn({ ticket: r.identifier, kind: r.kind }, 'ticket had no open approval though it was waiting on one; raised a fresh one');
    let conductor: Agent;
    try { conductor = deps().workers.conductor(); } catch { return; }
    deps().wake.enqueue(conductor.id, {
      source: 'system',
      reason: `${repaired.length} ticket(s) had no open approval though they were waiting on one — a fresh approval was raised: ${repaired.map((r) => `${r.identifier} (${r.kind})`).join(', ')}`,
      payload: { kind: 'approval_repaired', tickets: repaired },
      requestedBy: { kind: 'system', id: null },
    });
  }

  interface UnreviewedApprovalRow { id: string; kind: string; ticketId: string | null; identifier: string | null; title: string; createdAt: string }

  /**
   * VS-469: a review-carrying approval that stays `unseen` re-wakes the weaver until it is reviewed or
   * closed. The card is woken for the weaver once at creation, and nothing else ever re-raises it, so
   * a weaver that believes it marked the card (as VOFM-77's did, without calling the tool) leaves it
   * stuck: excluded from the human's Needs-you count, unapprovable without an override, and invisible
   * to every later digest. This scan is the missing reader.
   *
   * Only `weaver_review_status = 'unseen'` on an `open`, human-owned review-carrying decision
   * qualifies — a mark, an answer, a supersede, a withdrawal or an expiry removes the row, so the
   * reminders stop by construction. The stage is derived from the card's age, and the wake key is
   * per (decision, stage), so Gate 0 dedupes a repeated scan and a reminder that arrives while the
   * weaver already has a queued wake coalesces into it (carrying `decisionId` in the bundle) rather
   * than stacking. The wake is an ordinary system wake: the dispatcher's run cap applies to it as to
   * any other, so it never starts a turn beyond the allowed concurrency.
   */
  function reviewReminderScan(): void {
    let conductor: Agent;
    try { conductor = deps().workers.conductor(); } catch { return; }
    const now = Date.now();
    const rows = ctx.db.all<UnreviewedApprovalRow>(
      `SELECT d.id AS id, d.kind AS kind, d.ticket_id AS ticketId, t.identifier AS identifier, d.title AS title, d.created_at AS createdAt
         FROM decisions d LEFT JOIN tickets t ON t.id = d.ticket_id
        WHERE d.workspace_id = ? AND d.status = 'open' AND d.owner = 'human'
          AND d.weaver_review_status = 'unseen'
          AND d.kind IN ('plan_approval','merge_approval','action_approval')
          AND d.created_at <= ?
        ORDER BY d.created_at`,
      [ctx.workspaceId, new Date(now - REVIEW_REMINDER_FIRST_MS).toISOString()],
    );
    for (const d of rows) {
      const ageMs = now - Date.parse(d.createdAt);
      const stage = reviewReminderStage(ageMs);
      if (stage === null) continue;
      const scope = d.identifier ? `${d.identifier} ` : '';
      const kind = d.kind.replace('_approval', '');
      try {
        deps().wake.enqueue(conductor.id, {
          source: 'system',
          reason: `approval card not reviewed for ${formatAge(d.createdAt)}: ${scope}${kind} "${d.title}"`,
          payload: { kind: 'review_reminder', decisionId: d.id, ticketId: d.ticketId, decisionKind: d.kind, ageMs },
          idempotencyKey: `review-reminder:${d.id}:${stage}`,
          requestedBy: SYSTEM,
        });
        log.info({ decisionId: d.id, kind: d.kind, stage, ageMs }, 'reminded the weaver of an unreviewed approval');
      } catch (e) { log.warn({ decisionId: d.id, err: String(e) }, 'review reminder wake failed'); }
    }
  }

  interface StalledAgentRow { id: string; ticketId: string; lastRunAt: string; identifier: string }

  /**
   * VS-202: a worker agent that cannot make further progress on its own — not retired, its ticket
   * not terminal, no open decision on that ticket, no wakeup queued or claimed for it, no run
   * queued or running for it, and its `last_run_at` older than the configured threshold. This is
   * deliberately independent of `watchdog()`: that one only ever looks at `runs` with
   * `status = 'running'`, so a worker whose turn ended cleanly and was simply never re-woken (the
   * VS-199 shape) falls entirely outside it.
   *
   * VS-498: also excludes a `blocked` ticket explicitly. A block is not always represented by an
   * open `decisions` row — a ticket-level `blockedBy` or an `{owner, action}` unblock can leave a
   * worker legitimately waiting with none of the other exclusions above in play — and this sweep now
   * drives bounded automatic recovery and escalation from its result, so a worker correctly blocked
   * must never enter that path.
   *
   * VS-516: also excludes a ticket waiting for merge-queue admission — `merging` with no
   * `merge_started_at`. Such a worker has no queued wake only because the queue itself will enqueue
   * one (and stamp the admission) when a slot frees, so it is a live action path even though no
   * `wakeups` row exists yet. This is the same condition `spawnPending()` uses to leave a queued
   * ticket unstaffed; the exclusion is deliberately narrow, never the whole `merging` status, so a
   * worker that *holds* the slot and goes quiet is still detected (the VS-391 shape).
   */
  function stalledWorkers(): StalledAgentRow[] {
    const timeoutMs = (ctx.config.defaults.stalledWorkerTimeoutSec ?? 300) * 1000;
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    // VS-317: a queued `self_scheduled` wake is an action path only while it is due or not yet past
    // its time by more than the grace margin. Past that the dispatcher would have claimed it, so the
    // worker has no route back and must be reported. Other queued wakes always count.
    const selfWakeCutoff = new Date(Date.now() - SELF_WAKE_STALL_GRACE_MS).toISOString();
    const excluded = [...TERMINAL_TICKET_STATUSES, 'blocked'];
    const excludedPlaceholders = excluded.map(() => '?').join(',');
    return ctx.db.all<StalledAgentRow>(
      `SELECT a.id AS id, a.ticket_id AS ticket_id, a.last_run_at AS last_run_at, t.identifier AS identifier
         FROM agents a JOIN tickets t ON t.id = a.ticket_id
        WHERE a.workspace_id = ? AND a.kind = 'worker' AND a.status != 'retired'
          AND t.status NOT IN (${excludedPlaceholders})
          AND t.interactive_session = 0
          AND NOT (t.status = 'merging' AND t.merge_started_at IS NULL)
          AND a.last_run_at IS NOT NULL AND a.last_run_at < ?
          AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.agent_id = a.id AND r.status IN ('queued','running'))
          AND NOT EXISTS (
            SELECT 1 FROM wakeups w WHERE w.agent_id = a.id
              AND (w.status = 'claimed'
                   OR (w.status = 'queued' AND NOT (w.source = 'self_scheduled' AND w.not_before IS NOT NULL AND w.not_before <= ?)))
          )
          AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.ticket_id = a.ticket_id AND d.status = 'open')`,
      [ctx.workspaceId, ...excluded, cutoff, selfWakeCutoff],
    );
  }

  /**
   * Raises `worker.stalled` (already a `DIGEST_EVENT_TYPES` member, so the conductor sees it on its
   * next digest with no extra wiring, and already invalidates the workers/ticket reads on the client
   * — VS-328) for each match, deduped per `(agentId, lastRunAt)` so a worker that is still stalled
   * next sweep is not re-notified every tick until it actually gets a new run.
   */
  function stalledWorkerScan(): void {
    for (const row of stalledWorkers()) {
      if (stalledNotified.get(row.id) === row.lastRunAt) continue;
      stalledNotified.set(row.id, row.lastRunAt);
      log.warn({ agentId: row.id, ticket: row.identifier, lastRunAt: row.lastRunAt }, 'worker is idle with an unfinished ticket and nothing left to wake it');
      ctx.events.emit('worker.stalled', 'agent', row.id, { ticketId: row.ticketId, reason: 'idle', lastRunAt: row.lastRunAt, state: 'stalled' });
    }
  }

  /**
   * VS-498: the reset half of stall recovery, run before `stallRecoveryScan` each pass so a worker
   * that already recovered is never re-flagged from a stale row. Walks every worker currently
   * persisted as being in an active stall/recovery cycle — independent of `stalledWorkers()`, which
   * an outstanding recovery wake or an open escalation decision deliberately removes the worker
   * from — and clears the cycle when either applies:
   *
   * - a `succeeded` run since the last recovery attempt (or since first detection, if none has been
   *   made yet) left observable evidence of progress on the ticket, using the same evidence test the
   *   stuck-worker gate uses; or
   * - its escalation decision exists and is no longer `open` (answered, withdrawn, expired or
   *   superseded) and no evidence of progress has been found either — the weaver has resolved it, so
   *   the worker starts with a clean slate: if it stalls again it gets the full number of automatic
   *   recovery attempts again, rather than escalating again immediately.
   */
  function stallRecoveryResetPass(): void {
    for (const state of allWorkerStallStates(ctx)) {
      // VS-516: a worker whose ticket is waiting for merge-queue admission is not stalled — the queue
      // will wake it when a slot frees. Clear any row it was carrying so the reads stop showing it as
      // stalled, and withdraw a stale escalation for the same reason.
      const ticket = ctx.db.get<{ status: string; mergeStartedAt: string | null }>(
        'SELECT status, merge_started_at AS mergeStartedAt FROM tickets WHERE id = ?', [state.ticketId]);
      if (ticket?.status === 'merging' && !ticket.mergeStartedAt) {
        if (state.escalationDecisionId) {
          try {
            const d = deps().decisions.list({ ticketId: state.ticketId }).find((x) => x.id === state.escalationDecisionId);
            if (d && d.status === 'open') deps().decisions.withdraw(SYSTEM, d.id, 'the worker is waiting for merge-queue admission');
          } catch (e) { log.warn({ agentId: state.agentId, err: String(e) }, 'could not withdraw a stall escalation decision'); }
        }
        deleteWorkerStallState(ctx, state.agentId);
        log.info({ agentId: state.agentId, ticketId: state.ticketId }, 'worker is waiting for merge-queue admission, not stalled');
        ctx.events.emit('worker.stalled', 'agent', state.agentId, { ticketId: state.ticketId, reason: 'merge_queue_wait', state: 'recovered' });
        continue;
      }
      const since = state.lastAttemptAt ?? state.firstDetectedAt;
      const progressed = ctx.db
        .all<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'succeeded' AND finished_at > ? ORDER BY finished_at", [state.agentId, since])
        .some((r) => runProducedEvidence(ctx, r.id, state.ticketId));
      if (progressed) {
        if (state.escalationDecisionId) {
          try {
            const d = deps().decisions.list({ ticketId: state.ticketId }).find((x) => x.id === state.escalationDecisionId);
            if (d && d.status === 'open') deps().decisions.withdraw(SYSTEM, d.id, 'the worker made progress on its own');
          } catch (e) { log.warn({ agentId: state.agentId, err: String(e) }, 'could not withdraw a stall escalation decision'); }
        }
        deleteWorkerStallState(ctx, state.agentId);
        log.info({ agentId: state.agentId, ticketId: state.ticketId }, 'worker recovered from a stall');
        ctx.events.emit('worker.stalled', 'agent', state.agentId, { ticketId: state.ticketId, reason: 'recovered', state: 'recovered' });
        continue;
      }
      if (state.escalationDecisionId) {
        const d = deps().decisions.list({ ticketId: state.ticketId }).find((x) => x.id === state.escalationDecisionId);
        if (d && d.status !== 'open') {
          deleteWorkerStallState(ctx, state.agentId);
          log.info({ agentId: state.agentId, ticketId: state.ticketId }, 'stall escalation resolved with no evidence of progress; clean slate');
          ctx.events.emit('worker.stalled', 'agent', state.agentId, { ticketId: state.ticketId, reason: 'escalation_resolved', state: 'recovered' });
        }
      }
    }
  }

  /**
   * VS-498: for each worker `stalledWorkers()` still matches, either enqueue a bounded automatic
   * recovery wake targeting that same worker agent — never a new one, so the pending-spawn sweep's
   * `worker_id IS NULL` guard keeps this ticket out of its consideration throughout — or, once the
   * configured cap of attempts is reached, raise a weaver-owned `gate_finding` instead of enqueueing
   * a further one. Once that decision is open, `stalledWorkers()`'s own "no open decision" clause
   * keeps this worker out of the next scan, so escalation only ever happens once per stall.
   */
  function stallRecoveryScan(): void {
    const cap = ctx.config.defaults.stalledWorkerMaxAutoRecoverAttempts ?? 2;
    const now = nowIso();
    for (const row of stalledWorkers()) {
      let state = getWorkerStallState(ctx, row.id);
      if (!state) {
        createWorkerStallState(ctx, row.id, row.ticketId, now);
        state = getWorkerStallState(ctx, row.id)!;
      }
      if (state.attempts < cap) {
        const attempt = state.attempts + 1;
        try {
          const w = deps().wake.enqueue(row.id, {
            source: 'system',
            reason: `stalled worker auto-resumed (attempt ${attempt} of ${cap})`,
            payload: { kind: 'stall_recovery', attempt, cap },
            idempotencyKey: `stall-recovery:${row.id}:${attempt}`,
            requestedBy: SYSTEM,
          });
          recordRecoveryAttempt(ctx, row.id, attempt, w.id, now);
          log.warn({ agentId: row.id, ticket: row.identifier, attempt, cap }, 'auto-recovering a stalled worker');
        } catch (e) { log.warn({ agentId: row.id, err: String(e) }, 'stall recovery wake failed'); }
        continue;
      }
      try {
        const d = deps().decisions.create(SYSTEM, {
          ticketId: row.ticketId, kind: 'gate_finding', owner: 'weaver',
          title: `${row.identifier}'s worker stalled after ${state.attempts} automatic recovery attempt(s)`,
          context: `The worker's last turn ended cleanly with its ticket unfinished and nothing left to wake it, and it did not recover after ${state.attempts} automatic nudge(s). Steer it, relaunch it, or cancel the ticket.`,
          correlationKey: `stalled-worker:${row.id}`,
        });
        recordEscalation(ctx, row.id, d.id, now);
        log.warn({ agentId: row.id, ticket: row.identifier, attempts: state.attempts }, 'stalled worker escalated to the weaver');
      } catch (e) { log.warn({ agentId: row.id, err: String(e) }, 'stall escalation failed'); }
    }
  }

  /**
   * A workspace whose conductor has never taken a turn but already has unassigned open tickets
   * (projects added before the wake-on-add existed, or a restored export) gets one nudge per boot.
   */
  function nudgeIdleConductor(): void {
    let conductor: Agent;
    try { conductor = deps().workers.conductor(); } catch { return; }
    const turns = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE agent_id = ?', [conductor.id])?.n ?? 0;
    if (turns > 0) return;
    const waiting = ctx.db.all<{ identifier: string }>(
      "SELECT identifier FROM tickets WHERE workspace_id = ? AND status IN ('backlog','todo') AND assignee_role_id IS NULL AND worker_id IS NULL ORDER BY created_at LIMIT 10",
      [ctx.workspaceId],
    );
    if (!waiting.length) return;
    deps().wake.enqueue(conductor.id, {
      source: 'system',
      reason: `${waiting.length} open ticket(s) have nobody assigned (${waiting.map((t) => t.identifier).join(', ')}); hire roles or assign them`,
      payload: { kind: 'unassigned_tickets', tickets: waiting.map((t) => t.identifier) },
      idempotencyKey: `unassigned_nudge:${new Date().toISOString().slice(0, 10)}`, requestedBy: { kind: 'system', id: null },
    });
  }

  /**
   * VS-245: the summary a finished run stored in its own structured report, or an explicit reason it
   * has none. Read from `runs.result_json` — the stored report's first reader — rather than the
   * `run.finished` event's `summary`, which conflates a report's summary with a raw final-text
   * excerpt and a runtime failure message and so cannot tell "the agent reported this" from "no
   * report was stored". The returned text is the agent's own account, never a verified outcome.
   */
  function digestRunSummary(runId: string): { agentReportedSummary?: string; summaryOmitted?: 'no_report' } {
    try {
      const row = ctx.db.get<{ result: { summary?: unknown } | null }>('SELECT result_json FROM runs WHERE id = ?', [runId]);
      const summary = row?.result?.summary;
      if (typeof summary === 'string' && summary.trim()) return { agentReportedSummary: summary };
    } catch { /* a failed read degrades to the explicit no-report entry below */ }
    return { summaryOmitted: 'no_report' };
  }

  interface PendingReviewEntry { decisionId: string; kind: string; ticketIdentifier: string | null; title: string; ageMs: number }

  /**
   * VS-469: the open human-owned approvals whose review state is still `unseen` — the cards a weaver
   * that believed it reviewed them would otherwise lose track of. Shared by the digest's explicit
   * "not reviewed" list, bounded so the payload cannot grow without bound.
   */
  function pendingReviewEntries(): PendingReviewEntry[] {
    const now = Date.now();
    return ctx.db.all<{ id: string; kind: string; identifier: string | null; title: string; createdAt: string }>(
      `SELECT d.id AS id, d.kind AS kind, t.identifier AS identifier, d.title AS title, d.created_at AS createdAt
         FROM decisions d LEFT JOIN tickets t ON t.id = d.ticket_id
        WHERE d.workspace_id = ? AND d.status = 'open' AND d.owner = 'human'
          AND d.weaver_review_status = 'unseen'
          AND d.kind IN ('plan_approval','merge_approval','action_approval')
        ORDER BY d.created_at LIMIT ?`,
      [ctx.workspaceId, DIGEST_PENDING_REVIEW_LIMIT],
    ).map((d) => ({ decisionId: d.id, kind: d.kind, ticketIdentifier: d.identifier, title: d.title, ageMs: now - Date.parse(d.createdAt) }));
  }

  function conductorDigest(): void {
    const interval = (ctx.config.defaults.weaverDigestIntervalSec ?? 120) * 1000;
    if (Date.now() - lastDigestAt < interval) return;
    const lastSeq = Number(meta('supervisor:digest_seq') ?? 0);
    const events = ctx.events.since(lastSeq, 200);
    if (!events.length) return;
    setMeta('supervisor:digest_seq', String(events[events.length - 1]!.seq));
    let conductor: Agent;
    try { conductor = deps().workers.conductor(); } catch { return; }
    const ROUTINE_TICKET_STATUSES = new Set(['backlog', 'todo', 'proposing', 'approved', 'in_progress']);
    const relevant = events.filter((e) => {
      if (!DIGEST_EVENT_TYPES.has(e.type)) return false;
      const p = (e.payload ?? {}) as Record<string, unknown>;
      // The conductor's own runs are never news to it.
      if (e.type === 'run.finished') {
        if (p.agentId === conductor.id || (p.agent as { id?: string } | undefined)?.id === conductor.id) return false;
        return ['blocked', 'needs_decision', 'failed'].includes(String(p.liveness));
      }
      // Routine ticket progress is visible in the board; only ownership changes toward the human/conductor are digest-worthy.
      if (e.type === 'ticket.status') {
        const status = String(p.status ?? (p.ticket as { status?: string } | undefined)?.status ?? '');
        return !ROUTINE_TICKET_STATUSES.has(status);
      }
      // Tickets the conductor filed itself are not news; anything a human or the system created is.
      if (e.type === 'ticket.created') return String(p.createdByKind ?? (p.ticket as { createdByKind?: string } | undefined)?.createdByKind ?? 'human') !== 'agent';
      // VS-361: a decision is not news to the weaver only when the weaver itself asked it. The old
      // test — keep when `owner !== 'human' || askedInRunId == null` — dropped every human-owned
      // decision raised inside a run, which is every worker's plan, merge and action approval.
      if (e.type === 'decision.created') {
        const askedBy = p.askedByAgentId ?? (p.decision as { askedByAgentId?: string | null } | undefined)?.askedByAgentId ?? null;
        return askedBy !== conductor.id;
      }
      return true;
    });
    if (!relevant.length) return;
    lastDigestAt = Date.now();
    // VS-245: a finished run's entry carries the summary it stored in its report, capped per entry
    // and across the digest. Entries past the total budget say their summary was omitted; a run with
    // no stored report says so plainly. The event list keeps its existing `slice(0, 30)` bound.
    type DigestEntry = { type: string; entityId: string; at: string; agentReportedSummary?: string; summaryOmitted?: 'no_report' | 'digest_cap' };
    const entries: DigestEntry[] = [];
    let summaryBudget = DIGEST_SUMMARY_TOTAL_CHARS;
    for (const e of relevant.slice(0, 30)) {
      const entry: DigestEntry = { type: e.type, entityId: e.entityId, at: e.createdAt };
      if (e.type === 'run.finished') {
        const stored = digestRunSummary(e.entityId);
        if (stored.agentReportedSummary === undefined) entry.summaryOmitted = 'no_report';
        else if (summaryBudget <= 0) entry.summaryOmitted = 'digest_cap';
        else {
          const text = capSummaryText(stored.agentReportedSummary, Math.min(DIGEST_SUMMARY_ENTRY_CHARS, summaryBudget));
          entry.agentReportedSummary = text;
          summaryBudget -= text.length;
        }
      }
      entries.push(entry);
    }
    // VS-469: an open approval the weaver never marked is not ordinary open work — it is waiting on
    // the weaver, and a weaver that has lost track of it reads it as already reviewed. Name every
    // such card on the digest itself, bounded, and in the wake reason so it is read without opening
    // the payload.
    const pendingReview = pendingReviewEntries();
    const reviewNote = pendingReview.length
      ? ` — ${pendingReview.length} approval card${pendingReview.length === 1 ? '' : 's'} still not reviewed: `
        + pendingReview.slice(0, 3).map((p) => `${p.ticketIdentifier ?? 'workspace'} ${p.kind.replace('_approval', '')} ${formatAge(new Date(Date.now() - p.ageMs).toISOString())}`).join(', ')
        + (pendingReview.length > 3 ? `, +${pendingReview.length - 3} more` : '')
      : '';
    try {
      deps().wake.enqueue(conductor.id, {
        source: 'system', reason: `digest${reviewNote}`,
        payload: { since: lastSeq, events: entries, ...(pendingReview.length ? { pendingReview } : {}) },
        requestedBy: { kind: 'system', id: null },
      });
    } catch (e) { log.warn({ err: String(e) }, 'digest wake failed'); }
  }


  // ---------- scheduled curation (PLAN §13.4) ----------

  interface KnowledgeFileRow {
    id: string; path: string; scope: string; projectId: string | null; tokenEstimate: number;
    budgetTokens: number; lastCuratedAt: string | null; curationPending: number; updatedAt: string;
  }

  /**
   * Knowledge files whose last curation (or, if never curated, whose creation) is older than 14
   * days, plus anything genuinely over its share of the configured budget.
   *
   * `curation_pending` is a cache of the second of those, written by whichever write last touched
   * the file. It outlives the condition that set it — a raised budget (VS-18) or a curator that
   * rewrote a different file in the same scope both leave it set — and the per-path cooldown then
   * turns one stuck flag into one curation ticket a day, for ever (VS-67). So the verdict is
   * re-derived here from the current size against the configured budget, and the row is repaired.
   */
  async function curationPass(): Promise<void> {
    // The stored size may predate token counting (it used to be a byte ratio): recount it from the
    // file on disk before deriving any over-budget verdict or curation_pending cache from it.
    try { deps().knowledge.recountSizes(); } catch (e) { log.warn({ err: String(e) }, 'knowledge recount before curation failed'); }
    const rows = ctx.db.all<KnowledgeFileRow>(
      'SELECT id, path, scope, project_id, token_estimate, budget_tokens, last_curated_at, curation_pending, updated_at FROM knowledge_files WHERE workspace_id = ?',
      [ctx.workspaceId],
    );
    const budgets = ctx.config.defaults.knowledgeBudgetTokens;
    const staleBefore = Date.now() - CURATION_STALE_MS;
    // VS-492: the never-read documents of the whole workspace, fetched once per pass. A failure here
    // leaves the budget/age verdict exactly as it was rather than failing the pass.
    const neverReadBefore = Date.now() - ctx.config.defaults.knowledgeNeverReadDays * DAY_MS;
    let neverReadKeys = new Set<string>();
    try {
      const refs = deps().knowledgeUsage.neverRead({ since: new Date(neverReadBefore).toISOString() });
      neverReadKeys = new Set(refs.map((r) => `${r.scope}:${r.projectId ?? ''}:${r.slug}`));
    } catch (e) { log.warn({ err: String(e) }, 'never-read sweep before curation failed'); }
    for (const f of rows) {
      // A row whose file is gone — deleted, archived, renamed, never materialised — has nothing to
      // curate, however old it looks.
      if (!existsSync(join(ctx.paths.knowledge, f.path))) {
        log.debug({ path: f.path, scope: f.scope }, 'curation skipped: no file on disk');
        continue;
      }
      const budget = budgetOf(budgets, f.scope as KnowledgeScope, isDocPath(f.path));
      const overBudget = f.tokenEstimate > budget * CURATION_BUDGET_FRACTION;
      // Keep the row honest about the budget in force and about what it implies. `updated_at` is
      // deliberately not touched: it is the staleness reference for a file never yet curated.
      if (f.budgetTokens !== budget || Boolean(f.curationPending) !== overBudget) {
        ctx.db.update('knowledge_files', f.id, { budgetTokens: budget, curationPending: overBudget });
      }
      const reference = Date.parse(f.lastCuratedAt ?? f.updatedAt ?? '');
      const stale = Number.isFinite(reference) && reference < staleBefore;
      const neverRead = isDocPath(f.path)
        && neverReadKeys.has(`${f.scope}:${f.projectId ?? ''}:${docSlugOf(f.path)}`)
        && Date.parse(f.updatedAt) < neverReadBefore;
      if (!stale && !overBudget && !neverRead) continue;

      const key = `supervisor:curation_requested:${f.path}`;
      const asked = Date.parse(meta(key) ?? '');
      if (Number.isFinite(asked) && Date.now() - asked < CURATION_REQUEST_COOLDOWN_MS) continue;
      setMeta(key, nowIso());
      const reason = overBudget ? 'over_budget' : stale ? 'stale' : 'never_read';
      const fields = {
        path: f.path, scope: f.scope, reason, tokenEstimate: f.tokenEstimate, budgetTokens: budget,
        lastCuratedAt: f.lastCuratedAt, since: f.lastCuratedAt ?? f.updatedAt,
        neverReadBefore,
      };
      try {
        await deps().knowledge.requestCuration(SYSTEM, f.scope as KnowledgeScope, f.projectId);
        log.info(fields, 'curation requested');
      } catch (e) {
        log.warn({ ...fields, err: String(e) }, 'curation request failed');
      }
    }
  }

  // ---------- knowledge health (VS-102) ----------

  /**
   * A project's (or the workspace's) knowledge health, as a sorted set of issue keys — comparable
   * across sweeps without caring which specific measure changed.
   */
  function healthSignature(h: { orphans: Array<{ path: string }>; stale: Array<{ path: string }>; neverRead?: Array<{ path: string }>; unresolvedLinks: Array<{ fromPath: string; toSlug: string }>; hubs: Array<{ path: string; nearBudget: boolean }> }, duplicateKeys: string[] = []): string[] {
    return [
      ...h.orphans.map((d) => `orphan:${d.path}`),
      ...h.stale.map((d) => `stale:${d.path}`),
      ...(h.neverRead ?? []).map((d) => `never-read:${d.path}`),
      ...duplicateKeys,
      ...h.unresolvedLinks.map((l) => `link:${l.fromPath}->${l.toSlug}`),
      ...h.hubs.filter((hub) => hub.nearBudget).map((hub) => `budget:${hub.path}`),
    ].sort();
  }

  /**
   * Compares each project's (and the workspace's) knowledge health against what it was at the last
   * sweep, and tells the conductor when it got worse — a new orphan, a new unresolved link, or a hub
   * newly past its budget share, or the scope's total issues newly reaching a threshold — before any
   * of that would otherwise surface only when a write was rejected for being over budget. An
   * unchanged or improving scope stays silent, and a scope's first sweep only records its starting
   * point: existing issues at that point are not "new."
   */
  async function knowledgeHealthPass(): Promise<void> {
    const scopes: Array<{ key: string; projectId: string | null }> = [{ key: 'workspace', projectId: null }];
    for (const p of ctx.db.all<{ id: string }>('SELECT id FROM projects WHERE workspace_id = ?', [ctx.workspaceId])) scopes.push({ key: p.id, projectId: p.id });

    for (const scope of scopes) {
      let health: Awaited<ReturnType<CoreServices['knowledge']['health']>>;
      try { health = deps().knowledge.health(scope.projectId); }
      catch (e) { log.warn({ err: String(e), scope: scope.key }, 'knowledge health sweep failed'); continue; }

      // VS-492: the bounded duplicate sweep rides this pass, which is the daemon's one channel for
      // telling the conductor the knowledge network got worse. Read-only; a failure leaves the pass
      // otherwise as it was.
      let duplicateKeys: string[] = [];
      let duplicatePairs: Array<{ a: string; b: string; pathA: string; pathB: string; score: number }> = [];
      try {
        const dup = deps().knowledge.duplicates(scope.projectId ? { projectId: scope.projectId } : {});
        duplicateKeys = dup.pairs.map((p) => `duplicate:${p.a.path}#${p.a.line}~${p.b.path}#${p.b.line}`);
        duplicatePairs = dup.pairs.map((p) => ({ a: p.a.text, b: p.b.text, pathA: p.a.path, pathB: p.b.path, score: Number(p.score.toFixed(3)) }));
      } catch (e) { log.warn({ err: String(e), scope: scope.key }, 'duplicate sweep failed'); }

      const signature = healthSignature(health, duplicateKeys);
      const metaKey = `supervisor:knowledge_health:${scope.key}`;
      const previousRaw = meta(metaKey);
      setMeta(metaKey, JSON.stringify(signature));
      if (previousRaw === null) continue; // first sweep of this scope: record, do not compare

      const previous = new Set(JSON.parse(previousRaw) as string[]);
      const current = new Set(signature);
      const isNew = signature.filter((k) => !previous.has(k));
      const crossedThreshold = previous.size < KNOWLEDGE_HEALTH_ISSUE_THRESHOLD && current.size >= KNOWLEDGE_HEALTH_ISSUE_THRESHOLD;
      if (!isNew.length && !crossedThreshold) continue;

      const cooldownKey = `supervisor:knowledge_health_notified:${scope.key}`;
      const notifiedAt = Date.parse(meta(cooldownKey) ?? '');
      if (Number.isFinite(notifiedAt) && Date.now() - notifiedAt < CURATION_REQUEST_COOLDOWN_MS) continue;
      setMeta(cooldownKey, nowIso());

      let conductor: Agent;
      try { conductor = deps().workers.conductor(); } catch { continue; }
      const cap = <T,>(arr: T[]): T[] => arr.slice(0, 10);
      deps().wake.enqueue(conductor.id, {
        source: 'system',
        reason: `knowledge health worsened for ${scope.key === 'workspace' ? 'the workspace' : scope.key}: ${isNew.length ? `${isNew.length} new issue(s)` : `${current.size} open issues`}`,
        payload: {
          kind: 'knowledge_health', projectId: scope.projectId,
          orphans: cap(health.orphans.map((d) => d.path)), unresolvedLinks: cap(health.unresolvedLinks.map((l) => `${l.fromPath} -> [[${l.toSlug}]]`)),
          staleDocs: cap(health.stale.map((d) => d.path)), nearBudgetHubs: cap(health.hubs.filter((hub) => hub.nearBudget).map((hub) => hub.path)),
          neverReadDocs: cap((health.neverRead ?? []).map((d) => d.path)),
          duplicatePairs: duplicatePairs.slice(0, 10),
        },
        requestedBy: SYSTEM,
      });
      log.info({ scope: scope.key, newIssues: isNew.length, totalIssues: current.size }, 'knowledge health worsened; conductor notified');
    }
  }

  // ---------- reconciliation (PLAN §7.5) ----------

  interface ProjectRow { id: string; slug: string; clonePath: string }
  interface PrRow { ticketId: string; identifier: string; kind: string; status: string; projectId: string | null; workerId: string | null; wpId: string; url: string; state: string | null }

  async function reconcilePass(): Promise<void> {
    const projects = ctx.db.all<ProjectRow>("SELECT id, slug, clone_path FROM projects WHERE workspace_id = ? AND status = 'ready'", [ctx.workspaceId]);
    for (const p of projects) {
      try { await deps().projects.fetch(p.id); }
      catch (e) { log.warn({ project: p.slug, err: String(e) }, 'reconcile fetch failed'); }
    }
    const byId = new Map(projects.map((p) => [p.id, p]));
    await reconcilePullRequests(byId);
    await reconcileOpenSpecArchives(byId);
    await reconcileKnowledgeRepoSwitches(byId);
  }

  /** `in_review` tickets with a PR: refresh its state on the work product and finish the ones the forge has merged. */
  async function reconcilePullRequests(projects: Map<string, ProjectRow>): Promise<void> {
    const forge = ctx.registries.forges.get('github');
    if (!forge) return;
    const rows = ctx.db.all<PrRow>(
      `SELECT t.id AS ticket_id, t.identifier AS identifier, t.kind AS kind, t.status AS status, t.project_id AS project_id,
              t.worker_id AS worker_id, wp.id AS wp_id, wp.url AS url, wp.state AS state
         FROM tickets t JOIN ticket_work_products wp ON wp.ticket_id = t.id AND wp.type = 'pull_request'
        WHERE t.workspace_id = ? AND t.status = 'in_review' AND wp.url IS NOT NULL
        ORDER BY wp.created_at DESC`,
      [ctx.workspaceId],
    );
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.ticketId)) continue;
      seen.add(row.ticketId);
      const project = row.projectId ? projects.get(row.projectId) : undefined;
      if (!project || !existsSync(project.clonePath)) continue;

      const pr = await forge.prState(project.clonePath, row.url).catch((e: unknown) => {
        log.warn({ ticket: row.identifier, url: row.url, err: String(e) }, 'PR state refresh failed');
        return null;
      });
      if (!pr) continue;
      const stateChanged = pr.state !== row.state;
      // VS-328: the check tally changes while the PR stays open (CI running), so it is compared and
      // written independently of the state change — otherwise it would freeze at the last state move.
      const stored = (ctx.db.get<{ delivery: Record<string, unknown> | null }>('SELECT delivery_json FROM tickets WHERE id = ?', [row.ticketId])?.delivery ?? {});
      const ciState = pr.ciState ?? null;
      const checks = pr.checks ?? null;
      // VS-481: the rollup by name, and the head this ticket's pull request currently points at, so a
      // merge card can name pending/failed checks and tell when its recorded CI is for another commit.
      const checkDetails = pr.checkDetails ?? null;
      const prHead = pr.headSha ?? null;
      const ciChanged = JSON.stringify(stored['ciState'] ?? null) !== JSON.stringify(ciState)
        || JSON.stringify(stored['prChecks'] ?? null) !== JSON.stringify(checks)
        || JSON.stringify(stored['ciChecks'] ?? null) !== JSON.stringify(checkDetails)
        || JSON.stringify(stored['prHead'] ?? null) !== JSON.stringify(prHead);
      if (stateChanged || ciChanged) {
        const now = nowIso();
        if (stateChanged) ctx.db.run('UPDATE ticket_work_products SET state = ?, updated_at = ? WHERE id = ?', [pr.state, now, row.wpId]);
        ctx.db.update('tickets', row.ticketId, { deliveryJson: { ...stored, prUrl: row.url, prState: pr.state, ciState, ciHead: prHead ?? stored['ciHead'] ?? null, prChecks: checks, ciChecks: checkDetails, prHead }, updatedAt: now });
        if (stateChanged) ctx.events.emit('ticket.work_product', 'ticket', row.ticketId, { ticketId: row.ticketId, id: row.wpId, type: 'pull_request', url: row.url, state: pr.state });
        // What the board reads its delivery from is the tickets query, so a checks-only change still needs this.
        if (ciChanged) ctx.events.emit('ticket.updated', 'ticket', row.ticketId, { ticketId: row.ticketId });
      }
      // VS-365: reconcile is where the daemon already refreshes a pull request's head, so a held
      // (`concerns`) merge card whose head moved since the review is noticed here too — the turn-end
      // check catches the worker's own push, this catches one made out of band. Idempotent per head.
      try {
        await deps().tickets.noteHeldReviewHead(SYSTEM, row.ticketId, pr.headSha);
      } catch (e) {
        log.warn({ ticket: row.identifier, err: String(e) }, 'held-review head check failed during reconcile');
      }
      if (pr.state !== 'merged') continue;

      const note = `the pull request was merged on the forge${pr.mergeCommit ? ` (${pr.mergeCommit.slice(0, 12)})` : ''}`;
      try {
        await deps().tickets.transition(SYSTEM, row.ticketId, { to: 'merging', note: `reconciliation: ${note}` });
      } catch (e) {
        log.warn({ ticket: row.identifier, err: String(e) }, 'reconciliation could not move the ticket to merging');
        continue;
      }
      const worker = liveWorkerFor(row.ticketId);
      if (worker) {
        try {
          deps().wake.enqueue(worker.id, {
            source: 'merge_approved',
            reason: `${row.identifier}: ${note} — do not merge again, just report weave_ticket_merge_done`,
            payload: { ticketId: row.ticketId, prUrl: row.url, mergeCommit: pr.mergeCommit ?? null, mergedOnForge: true, note },
            idempotencyKey: `reconcile-merged:${row.ticketId}`,
            requestedBy: SYSTEM,
          });
        } catch (e) { log.warn({ ticket: row.identifier, err: String(e) }, 'merge_approved wake failed'); }
      } else {
        try {
          // VS-232: mergeDone treats this forge SHA as the trusted merge commit when verifying landing.
          await deps().tickets.mergeDone(SYSTEM, row.ticketId, { mergeCommit: pr.mergeCommit, method: 'forge' });
          log.info({ ticket: row.identifier, mergeCommit: pr.mergeCommit }, 'reconciliation completed a merge with no live worker');
        } catch (e) { log.warn({ ticket: row.identifier, err: String(e) }, 'reconciliation mergeDone failed'); }
      }
    }
  }

  interface MergingPrRow { id: string; identifier: string; projectId: string; url: string; clonePath: string; delivery: Record<string, unknown> | null; mergeStartedAt: string | null }

  /**
   * VS-467: tell the weaver that a merge-slot holder has waited too long on unresolved checks. A
   * supervisor alarm, not a ticket failure — the landing keeps waiting and the alarm clears itself
   * when the checks resolve. Names the ticket, pull request, head SHA and what the rollup shows, and
   * appends the self-hosted runner gap when a workflow asks for a label no online runner serves.
   * Best-effort: it never throws into the tick.
   */
  async function raiseMergeChecksAlarm(forge: ForgeAdapter, row: MergingPrRow, ciState: string | null, checks: { passed: number; total: number } | null, head: string | null, thresholdMs: number): Promise<void> {
    const description = ciState === 'pending'
      ? `a run is in progress${checks ? ` (${checks.passed}/${checks.total} passed)` : ''}`
      : `no successful run on ${head ?? 'the head'} (no run, all checks skipped or cancelled)`;
    let runnerNote = '';
    try {
      const requested = requestedRunnerLabels(row.clonePath);
      const online = forge.runnerStatus ? (await forge.runnerStatus(row.clonePath))?.onlineLabels ?? null : null;
      const gaps = online ? runnerGaps(requested, online) : [];
      if (gaps.length > 0) runnerNote = `; no online runner for ${gaps.map((label) => `\`${label}\``).join(', ')}`;
    } catch { /* runner awareness is best-effort and never fails the alarm */ }
    const mins = Math.round(thresholdMs / 60_000);
    const message = `${row.identifier}: the merge slot has been held on ${row.url} for over ${mins} min with checks unresolved — ${description}${runnerNote} (head ${head ?? 'unknown'}). The landing is still waiting and has not merged.`;
    log.warn({ ticket: row.identifier, url: row.url, ciState, head }, 'merge-slot holder stalled on checks');
    try { deps().tickets.comment(SYSTEM, row.id, message, 'status'); }
    catch (e) { log.warn({ ticket: row.identifier, err: String(e) }, 'merge-stall comment failed'); }
    let conductor: Agent;
    try { conductor = deps().workers.conductor(); } catch { return; }
    try {
      deps().wake.enqueue(conductor.id, {
        source: 'system',
        reason: message,
        payload: { ticketId: row.id, kind: 'merge_stalled', prUrl: row.url, headSha: head, ciState, checks },
        idempotencyKey: `merge-stalled:${row.id}:${Date.now()}`,
        requestedBy: SYSTEM,
      });
    } catch (e) { log.warn({ ticket: row.identifier, err: String(e) }, 'merge-stall wake failed'); }
  }

  /**
   * VS-391: wake the worker holding a project's merge slot when its pull request's checks resolve (or
   * its merge state becomes clean). Runs on the supervisor tick, throttled to `MERGE_POLL_EVERY_MS`,
   * and polls only tickets admitted to the active merge step — a merging ticket still waiting in the
   * queue has no merge turn to wake. Only the forge's pull-request state is read; unlike
   * `reconcilePass` this never fetches the projects.
   */
  async function wakeMergingOnProgress(): Promise<void> {
    const forge = ctx.registries.forges.get('github');
    if (!forge) return;
    const rows = ctx.db.all<MergingPrRow>(
      `SELECT t.id AS id, t.identifier AS identifier, t.project_id AS project_id, wp.url AS url,
              p.clone_path AS clone_path, t.delivery_json AS delivery_json, t.merge_started_at AS merge_started_at
         FROM tickets t
         JOIN ticket_work_products wp ON wp.ticket_id = t.id AND wp.type = 'pull_request' AND wp.url IS NOT NULL
         JOIN projects p ON p.id = t.project_id AND p.status = 'ready'
        WHERE t.workspace_id = ? AND t.status = 'merging' AND t.merge_started_at IS NOT NULL
        ORDER BY wp.created_at DESC`,
      [ctx.workspaceId],
    );
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (!existsSync(row.clonePath)) continue;
      const pr = await forge.prState(row.clonePath, row.url).catch((e: unknown) => {
        log.warn({ ticket: row.identifier, url: row.url, err: String(e) }, 'merge-slot pull request poll failed');
        return null;
      });
      if (!pr) continue;

      const stored = row.delivery ?? {};
      const ciState = pr.ciState ?? null;
      const checks = pr.checks ?? null;
      const checkDetails = pr.checkDetails ?? null;
      const head = pr.headSha ?? (typeof stored['ciHead'] === 'string' ? stored['ciHead'] : null);
      const mergeState = pr.mergeState ?? null;
      const draft = pr.isDraft === true;
      const ciChanged = JSON.stringify(stored['ciState'] ?? null) !== JSON.stringify(ciState)
        || JSON.stringify(stored['prChecks'] ?? null) !== JSON.stringify(checks)
        || JSON.stringify(stored['ciChecks'] ?? null) !== JSON.stringify(checkDetails)
        || JSON.stringify(stored['ciHead'] ?? null) !== JSON.stringify(head);
      const mergeStateChanged = (stored['mergeState'] ?? null) !== mergeState;
      const stateChanged = (stored['prState'] ?? null) !== pr.state;
      const draftChanged = (stored['isDraft'] === true) !== draft;
      const now = nowIso();
      const ciStateAt = ciState !== (stored['ciState'] ?? null) ? now : (stored['ciStateAt'] as string | undefined) ?? now;
      if (ciChanged || mergeStateChanged || stateChanged || draftChanged) {
        ctx.db.update('tickets', row.id, {
          deliveryJson: {
            ...stored, prUrl: row.url, prState: pr.state, ciState, ciStateAt, ciHead: head, prChecks: checks,
            ciChecks: checkDetails, prHead: head,
            mergeState, mergeStateHead: mergeState ? head : null, isDraft: draft,
          },
          updatedAt: now,
        });
        if (ciChanged) ctx.events.emit('ticket.updated', 'ticket', row.id, { ticketId: row.id });
      }

      // A draft's absent checks are not "resolved" (VS-393 makes ticket PRs drafts until the merge
      // step marks them ready), so a draft never wakes the worker.
      if (draft) continue;
      const ciResolved = ciState === 'success' || ciState === 'failure';
      // VS-467: a non-draft holder past the threshold with unresolved checks alarms the weaver,
      // throttled to the same cadence; a resolved holder clears its entry. Fired before the
      // worker lookup: the slot is held whether or not a live worker happens to exist.
      const alarmThresholdMs = (ctx.config.defaults.mergeChecksAlarmSec ?? 1200) * 1000;
      if (!ciResolved) {
        const startedAt = row.mergeStartedAt ? Date.parse(row.mergeStartedAt) : NaN;
        const last = mergeChecksAlarmedAt.get(row.id);
        if (Number.isFinite(startedAt) && Date.now() - startedAt >= alarmThresholdMs
          && (last === undefined || Date.now() - last >= alarmThresholdMs)) {
          mergeChecksAlarmedAt.set(row.id, Date.now());
          await raiseMergeChecksAlarm(forge, row, ciState, checks, head, alarmThresholdMs);
        }
      } else {
        mergeChecksAlarmedAt.delete(row.id);
      }
      const worker = liveWorkerFor(row.id);
      if (!worker) {
        log.warn({ ticket: row.identifier }, 'merge-slot pull request moved but the ticket has no live worker');
        continue;
      }
      const ciTransition = ciResolved && ((stored['ciState'] ?? null) !== ciState || (stored['ciHead'] ?? null) !== head);
      // `blocked` while checks are still pending is GitHub's normal running state, not news; it is a
      // trigger only once the rollup has resolved. `clean` always is.
      const mergeTransition = mergeStateChanged && (mergeState === 'clean' || (ciResolved && mergeState === 'blocked'));
      if (ciTransition) {
        const passed = ciState === 'success';
        try {
          deps().wake.enqueue(worker.id, {
            source: 'merge_approved',
            reason: passed
              ? `${row.identifier}: required checks passed on ${row.url}; re-sync and request landing with weave_ticket_merge_done`
              : `${row.identifier}: required checks failed on ${row.url}; fix the failure and request landing again`,
            payload: { ticketId: row.id, ciState, prChecks: checks, mergeState, prUrl: row.url, headSha: head },
            idempotencyKey: `merge-ci:${row.id}:${head ?? 'unknown'}:${ciState}`,
            requestedBy: SYSTEM,
          });
        } catch (e) { log.warn({ ticket: row.identifier, err: String(e) }, 'merge-slot wake failed'); }
      } else if (mergeTransition) {
        try {
          deps().wake.enqueue(worker.id, {
            source: 'merge_approved',
            reason: `${row.identifier}: pull request merge state is ${mergeState} on ${row.url}; re-sync and request landing with weave_ticket_merge_done`,
            payload: { ticketId: row.id, ciState, prChecks: checks, mergeState, prUrl: row.url, headSha: head },
            idempotencyKey: `merge-state:${row.id}:${head ?? 'unknown'}:${mergeState}`,
            requestedBy: SYSTEM,
          });
        } catch (e) { log.warn({ ticket: row.identifier, err: String(e) }, 'merge-state wake failed'); }
      }
    }
    // VS-467: a ticket that has left the merge step (landed or withdrawn) keeps no alarm entry.
    for (const id of [...mergeChecksAlarmedAt.keys()]) if (!seen.has(id)) mergeChecksAlarmedAt.delete(id);
  }

  /** A `change` ticket can be `done` while its OpenSpec change directory is still un-archived on disk (§12.4 drift). */
  /**
   * `openspec_change_name IS NOT NULL` is already the full membership test — a `scout`/`question`
   * ticket never gets one (PLAN §12.2), and a `task` ticket in an OpenSpec-enabled project does
   * (`skip_specs: true`). No `kind` restriction: a `task` ticket's tracker change is backfilled the
   * same as a `change` ticket's (VS-208 — a `kind = 'change'` clause here left a fully-merged,
   * fully-valid tracker change unarchived indefinitely).
   */
  async function reconcileOpenSpecArchives(projects: Map<string, ProjectRow>): Promise<void> {
    const rows = ctx.db.all<{ id: string; identifier: string; projectId: string | null; changeName: string; delivery: Record<string, unknown> | null }>(
      "SELECT id, identifier, project_id, openspec_change_name AS change_name, delivery_json FROM tickets WHERE workspace_id = ? AND status = 'done' AND openspec_change_name IS NOT NULL",
      [ctx.workspaceId],
    );
    for (const t of rows) {
      const project = t.projectId ? projects.get(t.projectId) : undefined;
      if (!project || !existsSync(project.clonePath)) continue;
      // VS-389: once the change is archived on the landing branch (however it got there), a pending
      // mark left on the ticket's delivery is cleared — checked before the live change directory,
      // which a completed archive has already moved away.
      if (archivedDirFor(project.clonePath, t.changeName)) {
        const a = t.delivery?.['openspecArchive'] as Record<string, unknown> | undefined;
        if (a && a['state'] === 'pending') {
          ctx.db.update('tickets', t.id, { deliveryJson: { ...t.delivery, openspecArchive: { ...a, state: 'landed' } }, updatedAt: nowIso() });
          ctx.events.emit('ticket.updated', 'ticket', t.id, { ticketId: t.id });
        }
        continue;
      }
      if (!existsSync(join(project.clonePath, 'openspec', 'changes', t.changeName))) continue;
      log.info({ ticket: t.identifier, change: t.changeName }, 'archiving an OpenSpec change left behind by a merged ticket');
      let res: Awaited<ReturnType<CoreServices['openspec']['archiveAfterMerge']>>;
      try { res = await deps().openspec.archiveAfterMerge(t.id); }
      catch (e) { recordReconcileArchiveFailure(t, e); continue; }
      // VS-570: a backfill that opens (or finds) a pull request is housekeeping for work the human
      // already shipped, so the daemon lands it itself — no merge card. Any archive card an earlier
      // version left open is withdrawn first. `landArchiveBackfill` never throws, defers on pending
      // checks and records a standing failure once, so calling it on every pass is safe.
      const pendingPr = res.pendingPrUrl ?? (typeof (t.delivery?.['openspecArchive'] as Record<string, unknown> | undefined)?.['pendingPrUrl'] === 'string'
        ? (t.delivery?.['openspecArchive'] as Record<string, string>)['pendingPrUrl'] : undefined);
      if (!pendingPr) continue;
      try {
        const stray = ctx.db.all<{ id: string }>(
          "SELECT id FROM decisions WHERE workspace_id = ? AND ticket_id = ? AND kind = 'merge_approval' AND status = 'open' AND correlation_key LIKE 'merge_approval:archive:%'",
          [ctx.workspaceId, t.id],
        );
        for (const d of stray) deps().decisions.withdraw(SYSTEM, d.id, 'the daemon lands spec archive backfills itself; no approval is needed');
        await deps().tickets.landArchiveBackfill(SYSTEM, {
          ticketId: t.id, changeName: res.changeName ?? t.changeName, branch: res.branch ?? `ac/archive-${t.changeName}`, prUrl: pendingPr,
        });
      } catch (e) { recordReconcileArchiveFailure(t, e); }
    }
  }

  /**
   * VS-359: a pending knowledge-repo switch is one pull request whose outcome decides the project's
   * opt-in. Poll it here, where a ticket's pull request is already reconciled, so the flag flips (or
   * the switch is cancelled) with no worker and no ticket. A merged pull request applies the flag and
   * fast-forwards the clone; a closed one clears the pending switch and changes nothing.
   */
  async function reconcileKnowledgeRepoSwitches(projects: Map<string, ProjectRow>): Promise<void> {
    const forge = ctx.registries.forges.get('github');
    if (!forge) return;
    const rows = ctx.db.all<{ id: string; slug: string; knowledgeSwitch: { direction: 'on' | 'off'; prUrl: string } | null }>(
      'SELECT id, slug, knowledge_switch_json FROM projects WHERE workspace_id = ? AND knowledge_switch_json IS NOT NULL',
      [ctx.workspaceId],
    );
    for (const row of rows) {
      const project = projects.get(row.id);
      const sw = row.knowledgeSwitch;
      if (!project || !sw || !existsSync(project.clonePath)) continue;
      const state = await forge.prState(project.clonePath, sw.prUrl).catch((e: unknown) => {
        log.warn({ project: row.slug, url: sw.prUrl, err: String(e) }, 'knowledge-repo switch state refresh failed');
        return null;
      });
      if (!state || state.state === 'open') continue;
      if (state.state === 'merged') {
        try {
          await deps().projects.applyKnowledgeRepoSwitch(deps().projects.get(row.id), sw.direction === 'on');
          await deps().projects.fetch(row.id).catch((e: unknown) => log.warn({ project: row.slug, err: String(e) }, 'knowledge-repo switch clone fetch failed'));
          log.info({ project: row.slug, direction: sw.direction }, 'knowledge-repo switch merged; opt-in applied');
        } catch (e) {
          log.warn({ project: row.slug, err: String(e) }, 'knowledge-repo switch apply failed');
        }
        continue;
      }
      // Closed unmerged: cancel, leaving the opt-in exactly as it was.
      ctx.db.update('projects', row.id, { knowledgeSwitchJson: null, updatedAt: nowIso() });
      log.info({ project: row.slug }, 'knowledge-repo switch cancelled (pull request closed)');
    }
  }

  /**
   * A reconciliation-triggered archive failure used to be only a `log.warn` — invisible to anyone
   * not reading logs, so a standing failure (like VS-205's) could retry and fail silently every
   * sweep. Records a comment on the ticket and wakes the conductor once per ticket for a given
   * standing failure (the wake system's own idempotency on `idempotencyKey` already dedupes a
   * `queued`/`claimed`/`coalesced`/`completed` wake, so a later sweep failing the same way does not
   * renotify — VS-208).
   */
  function recordReconcileArchiveFailure(t: { id: string; identifier: string; changeName: string }, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    log.warn({ ticket: t.identifier, change: t.changeName, err: message }, 'reconciliation archive failed');
    try { deps().tickets.comment(SYSTEM, t.id, `reconciliation could not archive ${t.changeName}: ${message}`, 'status'); }
    catch (ce) { log.warn({ ticket: t.identifier, err: String(ce) }, 'reconciliation archive-failure comment failed'); }
    let conductor: Agent;
    try { conductor = deps().workers.conductor(); } catch { return; }
    try {
      deps().wake.enqueue(conductor.id, {
        source: 'system',
        reason: `openspec archive failed for ${t.identifier}: ${message}`,
        payload: { ticketId: t.id, changeName: t.changeName, error: message },
        idempotencyKey: `reconcile-archive-failed:${t.id}`,
        requestedBy: SYSTEM,
      });
    } catch (we) { log.warn({ ticket: t.identifier, err: String(we) }, 'reconciliation archive-failure wake failed'); }
  }

  // ---------- retention (PLAN §16.1) ----------

  /** Prune run log directories and worker archives past their retention. DB rows stay; only `log_path` is cleared. */
  function retentionPass(): void {
    const runCutoff = new Date(Date.now() - (ctx.config.defaults.runLogRetentionDays ?? 30) * DAY_MS).toISOString();
    let runsPruned = 0;
    for (const r of ctx.db.all<{ id: string; logPath: string | null }>(
      'SELECT id, log_path FROM runs WHERE workspace_id = ? AND finished_at IS NOT NULL AND finished_at < ?', [ctx.workspaceId, runCutoff],
    )) {
      const dir = join(ctx.paths.runs, r.id);
      const present = existsSync(dir);
      if (!present && !r.logPath) continue;
      if (present) {
        try { rmSync(dir, { recursive: true, force: true }); runsPruned += 1; }
        catch (e) { log.warn({ runId: r.id, err: String(e) }, 'run log removal failed'); continue; }
      }
      if (r.logPath) ctx.db.update('runs', r.id, { logPath: null });
    }

    const archiveCutoff = Date.now() - (ctx.config.defaults.workerArchiveDays ?? 30) * DAY_MS;
    let archivesPruned = 0;
    if (existsSync(ctx.paths.archive)) {
      for (const entry of readdirSync(ctx.paths.archive, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(ctx.paths.archive, entry.name);
        const agent = ctx.db.get<{ retiredAt: string | null }>('SELECT retired_at FROM agents WHERE id = ?', [entry.name]);
        let at = agent?.retiredAt ? Date.parse(agent.retiredAt) : NaN;
        if (!Number.isFinite(at)) { try { at = statSync(dir).mtimeMs; } catch { continue; } }
        if (at > archiveCutoff) continue;
        try { rmSync(dir, { recursive: true, force: true }); archivesPruned += 1; }
        catch (e) { log.warn({ workerId: entry.name, err: String(e) }, 'worker archive removal failed'); }
      }
    }
    if (runsPruned || archivesPruned) log.info({ runsPruned, archivesPruned }, 'retention sweep');
  }

  const supervisor: Supervisor = {
    async tick(): Promise<void> {
      if (ticking) return;
      ticking = true;
      try {
        if (!bootRecovered) {
          bootRecovered = true;
          await bootRecovery().catch((e) => log.error({ err: String(e) }, 'boot recovery failed'));
          await reprovisionMissingWorktrees().catch((e) => log.error({ err: String(e) }, 'worktree reprovision at boot failed'));
          await sweepScratch().catch((e) => log.error({ err: String(e) }, 'scratch sweep at boot failed'));
          try { nudgeIdleConductor(); } catch (e) { log.warn({ err: String(e) }, 'idle conductor nudge failed'); }
        }
        await watchdog().catch((e) => log.error({ err: String(e) }, 'watchdog failed'));
        await spawnPending().catch((e) => log.error({ err: String(e) }, 'spawn pass failed'));
        { const sweep = deps().tickets.autoMergeSweep; if (typeof sweep === 'function') await sweep.call(deps().tickets).catch((e: unknown) => log.error({ err: String(e) }, 'auto-merge sweep failed')); }
        // VS-670: the decision-centric safety net, so a reviewed card the merge sweep cannot see is
        // still caught and surfaced rather than sitting silently for hours.
        { const sweep = deps().tickets.staleReviewSweep; if (typeof sweep === 'function') await sweep.call(deps().tickets).catch((e: unknown) => log.error({ err: String(e) }, 'stale-review sweep failed')); }
        await pumpMergeQueues().catch((e) => log.error({ err: String(e) }, 'merge queue pump failed'));
        if (due('supervisor:merge_ci_at', MERGE_POLL_EVERY_MS)) {
          await wakeMergingOnProgress().catch((e) => log.error({ err: String(e) }, 'merge-slot progress wake failed'));
          // VS-584: complete a promotion pull request whose checks have resolved — the human's
          // approval is already recorded, so no card is waiting to be answered again.
          await deps().promotion.advance().catch((e) => log.error({ err: String(e) }, 'promotion advance failed'));
        }
        await retireFinished().catch((e) => log.error({ err: String(e) }, 'retire pass failed'));
        await retireIdleSessions().catch((e) => log.error({ err: String(e) }, 'idle session retire pass failed'));
        await reconcileAbandonedHandovers().catch((e) => log.error({ err: String(e) }, 'abandoned handover sweep failed'));
        if (Date.now() - lastLiveness > LIVENESS_EVERY_MS) {
          lastLiveness = Date.now();
          try { livenessScan(); } catch (e) { log.error({ err: String(e) }, 'liveness scan failed'); }
          await approvalIntegrityScan().catch((e) => log.error({ err: String(e) }, 'approval integrity scan failed'));
          // VS-306: withdraw stale open decisions on already-terminal tickets. Disjoint from the
          // repair scan above — that one raises approvals only for non-terminal tickets.
          try { deps().decisions.sweepTerminalTickets(SYSTEM, TERMINAL_DECISION_GRACE_MS); }
          catch (e) { log.error({ err: String(e) }, 'stale terminal-decision sweep failed'); }
          try { stalledWorkerScan(); } catch (e) { log.error({ err: String(e) }, 'stalled worker scan failed'); }
          try { stallRecoveryResetPass(); } catch (e) { log.error({ err: String(e) }, 'stall recovery reset pass failed'); }
          try { stallRecoveryScan(); } catch (e) { log.error({ err: String(e) }, 'stall recovery scan failed'); }
          // VS-469: re-wake the weaver for an approval it left unreviewed past the first threshold.
          try { reviewReminderScan(); } catch (e) { log.error({ err: String(e) }, 'review reminder scan failed'); }
          // VS-632: an open card whose landing head moved is recomputed in place and the weaver is
          // woken to review the new head, so a stale review cannot leave it unapprovable. On the
          // liveness cadence, not the faster merge-CI one, because each refresh fetches the remote.
          await deps().promotion.refresh().catch((e) => log.error({ err: String(e) }, 'promotion refresh failed'));
        }
        try { await deps().decisions.expireDue(); } catch { /* decisions service unavailable */ }
        try { deps().routines.fireDue(); } catch { /* routines service unavailable */ }
        try { conductorDigest(); } catch (e) { log.error({ err: String(e) }, 'digest failed'); }
        if (due('supervisor:curation_at', CURATION_EVERY_MS)) await curationPass().catch((e) => log.error({ err: String(e) }, 'curation pass failed'));
        if (due('supervisor:knowledge_health_at', KNOWLEDGE_HEALTH_EVERY_MS)) await knowledgeHealthPass().catch((e) => log.error({ err: String(e) }, 'knowledge health pass failed'));
        if (due('supervisor:accounts_at', ACCOUNTS_EVERY_MS)) { try { await deps().accounts.refresh(); } catch (e) { log.error({ err: String(e) }, 'runtime account refresh failed'); } }
        if (due('supervisor:login_recheck_at', LOGIN_RECHECK_EVERY_MS)) await loginRecheck().catch((e) => log.error({ err: String(e) }, 'runtime login recheck failed'));
        if (due('supervisor:reconcile_at', RECONCILE_EVERY_MS)) await reconcilePass().catch((e) => log.error({ err: String(e) }, 'reconcile pass failed'));
        if (due('supervisor:retention_at', RETENTION_EVERY_MS)) { try { retentionPass(); } catch (e) { log.error({ err: String(e) }, 'retention pass failed'); } }
        if (due('supervisor:scratch_at', SCRATCH_SWEEP_EVERY_MS)) await sweepScratch().catch((e) => log.error({ err: String(e) }, 'scratch sweep failed'));
      } finally {
        ticking = false;
      }
    },

    start(): void {
      if (timer) return;
      timer = setInterval(() => { void supervisor.tick(); }, TICK_MS);
      timer.unref?.();
    },

    stop(): void {
      if (timer) { clearInterval(timer); timer = null; }
    },

    running(): boolean {
      return timer !== null;
    },
  };
  return supervisor;
}
