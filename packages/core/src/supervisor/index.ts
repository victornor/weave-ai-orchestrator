import { existsSync } from 'node:fs';
import { nowIso } from '@openconductor/db';
import { WORKER_STATUSES, TERMINAL_TICKET_STATUSES, type Agent, type Run, type Ticket } from '@openconductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices, Supervisor } from '../api.js';
import { runState } from '../runs/active.js';
import { sh } from '../util/exec.js';

const TICK_MS = 15_000;
const LIVENESS_EVERY_MS = 60_000;
const KILL_AFTER_INTERRUPT_MS = 30_000;

const DIGEST_EVENT_TYPES = new Set(['ticket.status', 'ticket.merged', 'decision.created', 'decision.expired', 'worker.stalled', 'worker.retired', 'run.finished']);

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
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;
  let bootRecovered = false;
  let lastLiveness = 0;
  let lastDigestAt = 0;

  const meta = (key: string): string | null => ctx.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null;
  const setMeta = (key: string, value: string): void => { ctx.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]); };

  const supervisorEvent = (runId: string, action: string, detail: Record<string, unknown>): void => {
    const seq = (ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(seq),0) n FROM run_events WHERE run_id = ?', [runId])?.n ?? 0) + 1;
    ctx.db.run('INSERT INTO run_events (run_id, seq, ts, type, stream, level, payload_json) VALUES (?,?,?,?,?,?,?)', [runId, seq, nowIso(), 'supervisor.action', 'system', 'warn', JSON.stringify({ action, ...detail })]);
  };

  async function bootRecovery(): Promise<void> {
    const running = ctx.db.all<Run>("SELECT * FROM runs WHERE workspace_id = ? AND status = 'running'", [ctx.workspaceId]);
    for (const run of running) {
      if (state.active.has(run.id)) continue;
      if (processAlive(run.pid)) continue;
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
    const tickets = ctx.db.all<Ticket>(
      `SELECT * FROM tickets WHERE workspace_id = ? AND status IN (${statuses}) AND assignee_role_id IS NOT NULL AND worker_id IS NULL ORDER BY created_at`,
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
        if (!r.retired) log.debug({ workerId: w.id, reason: r.reason }, 'worker kept: work has not landed');
      } catch (e) { log.warn({ workerId: w.id, err: String(e) }, 'retire attempt failed'); }
    }
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
      // Decisions the conductor itself asked the human are not news to it either.
      if (e.type === 'decision.created') return String(p.owner ?? (p.decision as { owner?: string } | undefined)?.owner ?? '') !== 'human' || p.askedInRunId == null;
      return true;
    });
    if (!relevant.length) return;
    lastDigestAt = Date.now();
    try {
      deps().wake.enqueue(conductor.id, {
        source: 'system', reason: 'digest',
        payload: { since: lastSeq, events: relevant.slice(0, 30).map((e) => ({ type: e.type, entityId: e.entityId, at: e.createdAt })) },
        requestedBy: { kind: 'system', id: null },
      });
    } catch (e) { log.warn({ err: String(e) }, 'digest wake failed'); }
  }

  const supervisor: Supervisor = {
    async tick(): Promise<void> {
      if (ticking) return;
      ticking = true;
      try {
        if (!bootRecovered) { bootRecovered = true; await bootRecovery().catch((e) => log.error({ err: String(e) }, 'boot recovery failed')); }
        await watchdog().catch((e) => log.error({ err: String(e) }, 'watchdog failed'));
        await spawnPending().catch((e) => log.error({ err: String(e) }, 'spawn pass failed'));
        await deps().tickets.autoMergeSweep().catch((e) => log.error({ err: String(e) }, 'auto-merge sweep failed'));
        await retireFinished().catch((e) => log.error({ err: String(e) }, 'retire pass failed'));
        if (Date.now() - lastLiveness > LIVENESS_EVERY_MS) { lastLiveness = Date.now(); try { livenessScan(); } catch (e) { log.error({ err: String(e) }, 'liveness scan failed'); } }
        try { await deps().decisions.expireDue(); } catch { /* decisions service unavailable */ }
        try { conductorDigest(); } catch (e) { log.error({ err: String(e) }, 'digest failed'); }
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
  };
  return supervisor;
}
