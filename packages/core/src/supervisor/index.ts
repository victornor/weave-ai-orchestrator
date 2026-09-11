import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso } from '@agent-conductor/db';
import { WORKER_STATUSES, TERMINAL_TICKET_STATUSES, TICKET_PRIORITIES, type Agent, type KnowledgeScope, type Run, type Ticket } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, Supervisor } from '../api.js';
import { runState } from '../runs/active.js';
import { ungateRuntime } from '../runs/authgate.js';
import { archivedDirFor } from '../openspec/index.js';
import { CURATION_BUDGET_FRACTION, budgetOf, isDocPath } from '../knowledge/files.js';
import { sh } from '../util/exec.js';

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

const SYSTEM: Actor = { kind: 'system', id: null };

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

  async function bootRecovery(): Promise<void> {
    const running = ctx.db.all<Run>("SELECT * FROM runs WHERE workspace_id = ? AND status = 'running'", [ctx.workspaceId]);
    for (const run of running) {
      if (state.active.has(run.id)) continue;
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
      supervisorEvent(run.id, 'boot_recovery', { previousStatus: 'running' });
      try {
        deps().wake.enqueue(run.agentId, { source: 'retry', reason: 'previous turn was interrupted', payload: { retryOfRunId: run.id, interrupted: true }, idempotencyKey: `boot-retry:${run.id}`, requestedBy: { kind: 'system', id: null } });
      } catch (e) { log.warn({ err: String(e) }, 'could not re-queue the interrupted run'); }
    }
  }

  async function watchdog(): Promise<void> {
    const silenceMs = (ctx.config.defaults.silenceTimeoutSec ?? 600) * 1000;
    const timeoutMs = (ctx.config.defaults.turnTimeoutSec ?? 2700) * 1000;
    const running = ctx.db.all<Run>("SELECT * FROM runs WHERE workspace_id = ? AND status = 'running'", [ctx.workspaceId]);
    for (const run of running) {
      const startedAt = new Date(run.startedAt ?? run.createdAt).getTime();
      const lastEventAt = new Date((run as unknown as { lastEventAt?: string }).lastEventAt ?? run.startedAt ?? run.createdAt).getTime();
      const now = Date.now();
      const hardTimedOut = now - startedAt > timeoutMs;
      const silent = now - lastEventAt > silenceMs;
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
        supervisorEvent(run.id, hardTimedOut ? 'hard_timeout_interrupt' : 'silence_interrupt', { silentMs: now - lastEventAt });
        ctx.events.emit('worker.stalled', 'agent', run.agentId, { runId: run.id, reason: hardTimedOut ? 'hard timeout' : 'silence' });
        log.warn({ runId: run.id, agentId: run.agentId, hardTimedOut }, 'interrupting a stuck run');
        try { if (entry) { entry.cancelled = 'interrupt'; await entry.cancel('interrupt'); } } catch { /* already gone */ }
        continue;
      }
      if (now - firstAt < KILL_AFTER_INTERRUPT_MS) continue;

      supervisorEvent(run.id, 'kill', { afterMs: now - firstAt });
      try { if (entry) { entry.cancelled = 'kill'; await entry.cancel('kill'); } } catch { /* already gone */ }
      interrupted.delete(run.id);
      if (!entry) {
        // Nothing in this process owns the run: close it out here.
        ctx.db.update('runs', run.id, { status: hardTimedOut ? 'timed_out' : 'failed', finishedAt: nowIso(), errorCode: hardTimedOut ? 'timeout' : 'silence', errorFamily: 'tooling' });
        ctx.db.run("UPDATE wakeups SET status = 'failed', finished_at = ? WHERE run_id = ?", [nowIso(), run.id]);
        ctx.db.update('agents', run.agentId, { status: 'active', updatedAt: nowIso() });
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
   * Advance every project's merge queue (PLAN §11.4). Transitions pump their own project, so this is
   * the recovery path: a queue whose head vanished with the daemon, or one left half-admitted by a
   * restart, starts moving again on the next tick without anyone acting.
   */
  async function pumpMergeQueues(): Promise<void> {
    const queue = deps().tickets.mergeQueue;
    if (!queue) return;
    await queue.pumpAll();
  }

  function livenessScan(): void {
    let violations: Ticket[] = [];
    try { violations = deps().tickets.livenessViolations(); } catch { return; }
    for (const ticket of violations) {
      const worker = ticket.workerId ? ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [ticket.workerId]) : liveWorkerFor(ticket.id);
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

  interface StalledAgentRow { id: string; ticketId: string; lastRunAt: string; identifier: string }

  /**
   * VS-202: a worker agent that cannot make further progress on its own — not retired, its ticket
   * not terminal, no open decision on that ticket, no wakeup queued or claimed for it, no run
   * queued or running for it, and its `last_run_at` older than the configured threshold. This is
   * deliberately independent of `watchdog()`: that one only ever looks at `runs` with
   * `status = 'running'`, so a worker whose turn ended cleanly and was simply never re-woken (the
   * VS-199 shape) falls entirely outside it.
   */
  function stalledWorkers(): StalledAgentRow[] {
    const timeoutMs = (ctx.config.defaults.stalledWorkerTimeoutSec ?? 300) * 1000;
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    const terminal = TERMINAL_TICKET_STATUSES.map(() => '?').join(',');
    return ctx.db.all<StalledAgentRow>(
      `SELECT a.id AS id, a.ticket_id AS ticket_id, a.last_run_at AS last_run_at, t.identifier AS identifier
         FROM agents a JOIN tickets t ON t.id = a.ticket_id
        WHERE a.workspace_id = ? AND a.kind = 'worker' AND a.status != 'retired'
          AND t.status NOT IN (${terminal})
          AND t.interactive_session = 0
          AND a.last_run_at IS NOT NULL AND a.last_run_at < ?
          AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.agent_id = a.id AND r.status IN ('queued','running'))
          AND NOT EXISTS (SELECT 1 FROM wakeups w WHERE w.agent_id = a.id AND w.status IN ('queued','claimed'))
          AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.ticket_id = a.ticket_id AND d.status = 'open')`,
      [ctx.workspaceId, ...TERMINAL_TICKET_STATUSES, cutoff],
    );
  }

  /**
   * Raises `worker.stalled` (already a `DIGEST_EVENT_TYPES` member, so the conductor sees it on its
   * next digest with no extra wiring) for each match, deduped per `(agentId, lastRunAt)` so a
   * worker that is still stalled next sweep is not re-notified until it actually gets a new run.
   * Detection only, per the ticket: nothing here enqueues a wakeup, retry or restart.
   */
  function stalledWorkerScan(): void {
    for (const row of stalledWorkers()) {
      if (stalledNotified.get(row.id) === row.lastRunAt) continue;
      stalledNotified.set(row.id, row.lastRunAt);
      log.warn({ agentId: row.id, ticket: row.identifier, lastRunAt: row.lastRunAt }, 'worker is idle with an unfinished ticket and nothing left to wake it');
      ctx.events.emit('worker.stalled', 'agent', row.id, { ticketId: row.ticketId, reason: 'idle', lastRunAt: row.lastRunAt });
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

  function conductorDigest(): void {
    const interval = (ctx.config.defaults.conductorDigestIntervalSec ?? 120) * 1000;
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
      // Decisions the conductor itself asked the human are not news to it either.
      if (e.type === 'decision.created') return String(p.owner ?? (p.decision as { owner?: string } | undefined)?.owner ?? '') !== 'human' || p.askedInRunId == null;
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
    try {
      deps().wake.enqueue(conductor.id, {
        source: 'system', reason: 'digest',
        payload: { since: lastSeq, events: entries },
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
    const rows = ctx.db.all<KnowledgeFileRow>(
      'SELECT id, path, scope, project_id, token_estimate, budget_tokens, last_curated_at, curation_pending, updated_at FROM knowledge_files WHERE workspace_id = ?',
      [ctx.workspaceId],
    );
    const budgets = ctx.config.defaults.knowledgeBudgetTokens;
    const staleBefore = Date.now() - CURATION_STALE_MS;
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
      if (!stale && !overBudget) continue;

      const key = `supervisor:curation_requested:${f.path}`;
      const asked = Date.parse(meta(key) ?? '');
      if (Number.isFinite(asked) && Date.now() - asked < CURATION_REQUEST_COOLDOWN_MS) continue;
      setMeta(key, nowIso());
      const reason = overBudget ? 'over_budget' : 'stale';
      const fields = {
        path: f.path, scope: f.scope, reason, tokenEstimate: f.tokenEstimate, budgetTokens: budget,
        lastCuratedAt: f.lastCuratedAt, since: f.lastCuratedAt ?? f.updatedAt,
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
  function healthSignature(h: { orphans: Array<{ path: string }>; stale: Array<{ path: string }>; unresolvedLinks: Array<{ fromPath: string; toSlug: string }>; hubs: Array<{ path: string; nearBudget: boolean }> }): string[] {
    return [
      ...h.orphans.map((d) => `orphan:${d.path}`),
      ...h.stale.map((d) => `stale:${d.path}`),
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

      const signature = healthSignature(health);
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
    reconcileOpenSpecArchives(byId);
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
      if (pr.state !== row.state) {
        const now = nowIso();
        ctx.db.run('UPDATE ticket_work_products SET state = ?, updated_at = ? WHERE id = ?', [pr.state, now, row.wpId]);
        const delivery = (ctx.db.get<{ delivery: Record<string, unknown> | null }>('SELECT delivery_json FROM tickets WHERE id = ?', [row.ticketId])?.delivery ?? {});
        ctx.db.update('tickets', row.ticketId, { deliveryJson: { ...delivery, prUrl: row.url, prState: pr.state }, updatedAt: now });
        ctx.events.emit('ticket.work_product', 'ticket', row.ticketId, { ticketId: row.ticketId, id: row.wpId, type: 'pull_request', url: row.url, state: pr.state });
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
            reason: `${row.identifier}: ${note} — do not merge again, just report ac_ticket_merge_done`,
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

  /** A `change` ticket can be `done` while its OpenSpec change directory is still un-archived on disk (§12.4 drift). */
  /**
   * `openspec_change_name IS NOT NULL` is already the full membership test — a `scout`/`question`
   * ticket never gets one (PLAN §12.2), and a `task` ticket in an OpenSpec-enabled project does
   * (`skip_specs: true`). No `kind` restriction: a `task` ticket's tracker change is backfilled the
   * same as a `change` ticket's (VS-208 — a `kind = 'change'` clause here left a fully-merged,
   * fully-valid tracker change unarchived indefinitely).
   */
  function reconcileOpenSpecArchives(projects: Map<string, ProjectRow>): void {
    const rows = ctx.db.all<{ id: string; identifier: string; projectId: string | null; changeName: string }>(
      "SELECT id, identifier, project_id, openspec_change_name AS change_name FROM tickets WHERE workspace_id = ? AND status = 'done' AND openspec_change_name IS NOT NULL",
      [ctx.workspaceId],
    );
    for (const t of rows) {
      const project = t.projectId ? projects.get(t.projectId) : undefined;
      if (!project || !existsSync(project.clonePath)) continue;
      if (!existsSync(join(project.clonePath, 'openspec', 'changes', t.changeName))) continue;
      if (archivedDirFor(project.clonePath, t.changeName)) continue;
      log.info({ ticket: t.identifier, change: t.changeName }, 'archiving an OpenSpec change left behind by a merged ticket');
      void deps().openspec.archiveAfterMerge(t.id).catch((e: unknown) => recordReconcileArchiveFailure(t, e));
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
          try { nudgeIdleConductor(); } catch (e) { log.warn({ err: String(e) }, 'idle conductor nudge failed'); }
        }
        await watchdog().catch((e) => log.error({ err: String(e) }, 'watchdog failed'));
        await spawnPending().catch((e) => log.error({ err: String(e) }, 'spawn pass failed'));
        { const sweep = deps().tickets.autoMergeSweep; if (typeof sweep === 'function') await sweep.call(deps().tickets).catch((e: unknown) => log.error({ err: String(e) }, 'auto-merge sweep failed')); }
        await pumpMergeQueues().catch((e) => log.error({ err: String(e) }, 'merge queue pump failed'));
        await retireFinished().catch((e) => log.error({ err: String(e) }, 'retire pass failed'));
        await retireIdleSessions().catch((e) => log.error({ err: String(e) }, 'idle session retire pass failed'));
        if (Date.now() - lastLiveness > LIVENESS_EVERY_MS) {
          lastLiveness = Date.now();
          try { livenessScan(); } catch (e) { log.error({ err: String(e) }, 'liveness scan failed'); }
          await approvalIntegrityScan().catch((e) => log.error({ err: String(e) }, 'approval integrity scan failed'));
          try { stalledWorkerScan(); } catch (e) { log.error({ err: String(e) }, 'stalled worker scan failed'); }
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
