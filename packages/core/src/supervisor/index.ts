import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso } from '@agent-conductor/db';
import { WORKER_STATUSES, TERMINAL_TICKET_STATUSES, type Agent, type KnowledgeScope, type Run, type Ticket } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import type { Actor, CoreServices, Supervisor } from '../api.js';
import { runState } from '../runs/active.js';
import { archivedDirFor } from '../openspec/index.js';
import { sh } from '../util/exec.js';

const TICK_MS = 15_000;
const LIVENESS_EVERY_MS = 60_000;
const KILL_AFTER_INTERRUPT_MS = 30_000;
const DAY_MS = 86_400_000;
/** PLAN §13.4: a knowledge file is due for curation 14 days after its last one; ask at most once a day. */
const CURATION_EVERY_MS = 10 * 60_000;
const CURATION_STALE_MS = 14 * DAY_MS;
const CURATION_REQUEST_COOLDOWN_MS = DAY_MS;
/** PLAN §7.5 reconciliation is hourly; PLAN §16.1 log retention is a daily sweep. */
const RECONCILE_EVERY_MS = 60 * 60_000;
const RETENTION_EVERY_MS = DAY_MS;

const SYSTEM: Actor = { kind: 'system', id: null };

const DIGEST_EVENT_TYPES = new Set(['ticket.created', 'project.added', 'ticket.status', 'ticket.merged', 'decision.created', 'decision.expired', 'worker.stalled', 'worker.retired', 'run.finished']);

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

  /** True at most once per `everyMs`, and the last run is persisted so a restart does not re-run immediately. */
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
    try {
      deps().wake.enqueue(conductor.id, {
        source: 'system', reason: 'digest',
        payload: { since: lastSeq, events: relevant.slice(0, 30).map((e) => ({ type: e.type, entityId: e.entityId, at: e.createdAt })) },
        requestedBy: { kind: 'system', id: null },
      });
    } catch (e) { log.warn({ err: String(e) }, 'digest wake failed'); }
  }


  // ---------- scheduled curation (PLAN §13.4) ----------

  interface KnowledgeFileRow { path: string; scope: string; projectId: string | null; lastCuratedAt: string | null; curationPending: number; updatedAt: string }

  /** Knowledge files whose last curation (or, if never curated, whose creation) is older than 14 days, plus anything already flagged. */
  async function curationPass(): Promise<void> {
    const rows = ctx.db.all<KnowledgeFileRow>(
      'SELECT path, scope, project_id, last_curated_at, curation_pending, updated_at FROM knowledge_files WHERE workspace_id = ?',
      [ctx.workspaceId],
    );
    const staleBefore = Date.now() - CURATION_STALE_MS;
    for (const f of rows) {
      const reference = Date.parse(f.lastCuratedAt ?? f.updatedAt ?? '');
      const stale = Number.isFinite(reference) && reference < staleBefore;
      if (!stale && !f.curationPending) continue;

      const key = `supervisor:curation_requested:${f.path}`;
      const asked = Date.parse(meta(key) ?? '');
      if (Number.isFinite(asked) && Date.now() - asked < CURATION_REQUEST_COOLDOWN_MS) continue;
      setMeta(key, nowIso());
      try {
        await deps().knowledge.requestCuration(SYSTEM, f.scope as KnowledgeScope, f.projectId);
        log.info({ path: f.path, scope: f.scope, reason: stale ? 'stale' : 'pending' }, 'curation requested');
      } catch (e) {
        log.warn({ path: f.path, err: String(e) }, 'curation request failed');
      }
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
          await deps().tickets.mergeDone(SYSTEM, row.ticketId, { mergeCommit: pr.mergeCommit, method: 'forge' });
          log.info({ ticket: row.identifier, mergeCommit: pr.mergeCommit }, 'reconciliation completed a merge with no live worker');
        } catch (e) { log.warn({ ticket: row.identifier, err: String(e) }, 'reconciliation mergeDone failed'); }
      }
    }
  }

  /** A `change` ticket can be `done` while its OpenSpec change directory is still un-archived on disk (§12.4 drift). */
  function reconcileOpenSpecArchives(projects: Map<string, ProjectRow>): void {
    const rows = ctx.db.all<{ id: string; identifier: string; projectId: string | null; changeName: string }>(
      "SELECT id, identifier, project_id, openspec_change_name AS change_name FROM tickets WHERE workspace_id = ? AND kind = 'change' AND status = 'done' AND openspec_change_name IS NOT NULL",
      [ctx.workspaceId],
    );
    for (const t of rows) {
      const project = t.projectId ? projects.get(t.projectId) : undefined;
      if (!project || !existsSync(project.clonePath)) continue;
      if (!existsSync(join(project.clonePath, 'openspec', 'changes', t.changeName))) continue;
      if (archivedDirFor(project.clonePath, t.changeName)) continue;
      log.info({ ticket: t.identifier, change: t.changeName }, 'archiving an OpenSpec change left behind by a merged ticket');
      void deps().openspec.archiveAfterMerge(t.id)
        .catch((e: unknown) => log.warn({ ticket: t.identifier, change: t.changeName, err: String(e) }, 'reconciliation archive failed'));
    }
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
        await retireFinished().catch((e) => log.error({ err: String(e) }, 'retire pass failed'));
        if (Date.now() - lastLiveness > LIVENESS_EVERY_MS) { lastLiveness = Date.now(); try { livenessScan(); } catch (e) { log.error({ err: String(e) }, 'liveness scan failed'); } }
        try { await deps().decisions.expireDue(); } catch { /* decisions service unavailable */ }
        try { conductorDigest(); } catch (e) { log.error({ err: String(e) }, 'digest failed'); }
        if (due('supervisor:curation_at', CURATION_EVERY_MS)) await curationPass().catch((e) => log.error({ err: String(e) }, 'curation pass failed'));
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
  };
  return supervisor;
}
