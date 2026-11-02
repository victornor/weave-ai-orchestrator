/**
 * What a restart that was not an upgrade tells the workspace (VS-339,
 * `daemon-restart/restart-announcement`).
 *
 * The daemon's own database is the only thing that crosses a restart, so it carries a small durable
 * lifecycle: when the process last booted and on which release, when it began a deliberate shutdown
 * and why, and how many start attempts failed. The daemon that comes back reads those records to say
 * whether the previous process shut down cleanly or crashed, then tells each workspace's weaver and
 * the chat.
 *
 * The reads, the writes and the two lines are pure functions of that record and the workspace
 * databases, so they are tested without a daemon, a listener or a systemd unit. The effectful half —
 * posting the line and enqueuing the wake — is `announceRestart`.
 */
import { nowIso, type Db } from '@weave-ai/db';
import { getLogger } from '@weave-ai/core';
import type { RestartNotice, RestartNoticeTurn, ServiceExit } from '@weave-ai/shared';
import type { WorkspaceRuntime } from './types.js';
import { clockTime } from './upgrade-announce.js';
import { readServiceExit } from './serviceExit.js';

const log = getLogger('daemon', { component: 'restart-notice' });

/** The daemon database's lifecycle keys. All under one prefix so nothing else collides. */
const KEYS = {
  bootAt: 'daemon.lifecycle.boot_at',
  bootRelease: 'daemon.lifecycle.boot_release',
  bootPid: 'daemon.lifecycle.boot_pid',
  bootInvocationId: 'daemon.lifecycle.boot_invocation_id',
  aliveAt: 'daemon.lifecycle.alive_at',
  shutdownAt: 'daemon.lifecycle.shutdown_at',
  shutdownReason: 'daemon.lifecycle.shutdown_reason',
  failedStartAt: 'daemon.lifecycle.failed_start_at',
  failedStartReason: 'daemon.lifecycle.failed_start_reason',
  failedStartCount: 'daemon.lifecycle.failed_start_count',
  announcedFor: 'daemon.lifecycle.restart_announced_for',
} as const;

/** What the durable lifecycle says about the previous process at the moment this one boots. */
export interface BootObservation {
  /** This boot's instant; also the window's upper bound for the previous process's runs. */
  bootAt: string;
  previousBootAt: string | null;
  previousBootRelease: string | null;
  /**
   * When the previous process recorded a deliberate shutdown; null when it crashed. A shutdown recorded
   * before the previous boot belongs to an earlier process and is never returned (VS-955).
   */
  downAt: string | null;
  /** The previous process's recorded shutdown reason; null whenever `downAt` is. */
  shutdownReason: string | null;
  /** True only when the previous process recorded a shutdown at or after its own boot. */
  clean: boolean;
  /** VS-955: the previous process's last liveness instant, when it is at or after its own boot. */
  lastAliveAt: string | null;
  /** VS-955: the service manager's invocation id the previous process booted under, when it had one. */
  previousInvocationId: string | null;
  failedStarts: { count: number; lastAt: string | null; lastReason: string | null };
}

/** A turn the previous shutdown cut off, named the way the weaver's wake carries it. */
export interface InterruptedTurn extends RestartNoticeTurn {
  /** The worker's project, so its `maxWorkers` cap can hold the turn back (VS-375). */
  projectId: string | null;
}

/** The workspace limits that decide which interrupted turns wait for a slot (VS-375). */
export interface CapacityLimits {
  /** The workspace run limit (`defaults.maxConcurrentRuns`). */
  runLimit: number;
  /** Slots taken by wakers that are not these turns: the weaver's own restart wake. */
  reserved: number;
  /** `maxWorkers` by project id; a project with no row is uncapped. */
  projectMaxWorkers: Map<string, number>;
}

/**
 * VS-375: which interrupted turns cannot start on the first dispatch because a run limit is reached.
 * `maxConcurrentRuns` bounds the whole workspace and the weaver's own restart wake takes one slot; a
 * project's `maxWorkers` bounds its own turns. Turns are taken in dispatch order (the same order the
 * dispatcher now uses), so the ones it starts first are not reported as waiting. Pure, so the notice
 * is testable without a daemon.
 */
export function queuedForCapacity(turns: InterruptedTurn[], limits: CapacityLimits): InterruptedTurn[] {
  const available = Math.max(0, limits.runLimit - limits.reserved);
  const usedPerProject = new Map<string, number>();
  const waiting: InterruptedTurn[] = [];
  let used = 0;
  for (const turn of turns) {
    const cap = turn.projectId === null ? undefined : limits.projectMaxWorkers.get(turn.projectId);
    const projectUsed = turn.projectId === null ? 0 : usedPerProject.get(turn.projectId) ?? 0;
    const fitsGlobal = used < available;
    const fitsProject = cap === undefined || projectUsed < cap;
    if (fitsGlobal && fitsProject) {
      used += 1;
      if (turn.projectId !== null) usedPerProject.set(turn.projectId, projectUsed + 1);
    } else {
      waiting.push(turn);
    }
  }
  return waiting;
}

function meta(db: Db, key: string): string | null {
  return db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null;
}

function setMeta(db: Db, key: string, value: string): void {
  db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

/**
 * Read the previous process's lifecycle, without writing. `clean` compares the last shutdown against
 * the last boot: a boot with no shutdown at or after it is a crash. The first boot has neither and is
 * reported as not-clean, though nothing announces it (there is no previous boot).
 *
 * VS-955: the shutdown on file after a crash is the one an *earlier* process recorded, so it is served
 * only when it is the previous process's own — otherwise the 2026-11-02 crash reported the shutdown of
 * the process before it, 17 hours stale, with its `SIGTERM`.
 */
export function observeBoot(db: Db, opts: { now: string; release: string | null; pid: number | null }): BootObservation {
  const previousBootAt = meta(db, KEYS.bootAt);
  const previousBootRelease = meta(db, KEYS.bootRelease);
  const recordedDownAt = meta(db, KEYS.shutdownAt);
  const aliveAt = meta(db, KEYS.aliveAt);
  const count = Number(meta(db, KEYS.failedStartCount) ?? 0);
  const clean = previousBootAt !== null && recordedDownAt !== null && recordedDownAt >= previousBootAt;
  return {
    bootAt: opts.now,
    previousBootAt,
    previousBootRelease,
    downAt: clean ? recordedDownAt : null,
    shutdownReason: clean ? meta(db, KEYS.shutdownReason) : null,
    clean,
    lastAliveAt: previousBootAt !== null && aliveAt !== null && aliveAt >= previousBootAt ? aliveAt : null,
    previousInvocationId: previousBootAt === null ? null : meta(db, KEYS.bootInvocationId),
    failedStarts: {
      count: Number.isFinite(count) && count > 0 ? count : 0,
      lastAt: meta(db, KEYS.failedStartAt),
      lastReason: meta(db, KEYS.failedStartReason),
    },
  };
}

/**
 * Record that this process is serving: its boot instant, release, pid and service-manager invocation
 * (VS-955; cleared when there is none, so a later boot never looks up another process's exit); reset
 * the failed-start count and start the liveness trail.
 */
export function markBooted(db: Db, opts: { now: string; release: string | null; pid: number | null; invocationId?: string | null }): void {
  setMeta(db, KEYS.bootAt, opts.now);
  if (opts.release !== null) setMeta(db, KEYS.bootRelease, opts.release);
  if (opts.pid !== null) setMeta(db, KEYS.bootPid, String(opts.pid));
  setMeta(db, KEYS.bootInvocationId, opts.invocationId ?? '');
  setMeta(db, KEYS.aliveAt, opts.now);
  setMeta(db, KEYS.failedStartCount, '0');
}

/** VS-955: the serving process is alive at `now`. Written every minute; the next boot's outage bound. */
export function recordAlive(db: Db, now: string): void {
  setMeta(db, KEYS.aliveAt, now);
}

/** VS-955: how often the serving daemon writes its liveness instant. */
export const ALIVE_EVERY_MS = 60_000;

/**
 * VS-955: rewrite the liveness instant every `everyMs` while serving. A failed write (a full disk is
 * exactly when it fails) is logged once per failing stretch and never thrown: the timer must not be
 * what takes the daemon down. Unref'd, so it never holds the process open.
 */
export function startLivenessTrail(db: Db, opts: { everyMs?: number; now?: () => string } = {}): { stop(): void } {
  const now = opts.now ?? nowIso;
  let failing = false;
  const timer = setInterval(() => {
    try {
      recordAlive(db, now());
      failing = false;
    } catch (e) {
      if (!failing) log.warn({ err: String(e) }, 'could not record the liveness instant');
      failing = true;
    }
  }, opts.everyMs ?? ALIVE_EVERY_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

/** Record that a deliberate shutdown began — written synchronously, before the process can die. */
export function recordShutdown(db: Db, reason: string, now: string): void {
  setMeta(db, KEYS.shutdownAt, now);
  setMeta(db, KEYS.shutdownReason, reason);
}

/** Record that a start attempt failed, with its reason, for the next successful boot to report. */
export function recordStartFailure(db: Db, reason: string, now: string): void {
  const count = Number(meta(db, KEYS.failedStartCount) ?? 0);
  setMeta(db, KEYS.failedStartCount, String((Number.isFinite(count) && count > 0 ? count : 0) + 1));
  setMeta(db, KEYS.failedStartAt, now);
  setMeta(db, KEYS.failedStartReason, reason.slice(0, 1000));
}

/**
 * The turns the previous process left cut off: those it recorded `interrupted_by_shutdown`, plus those
 * still `running` when it died (which boot recovery re-queues moments later). Bounded to runs created
 * in the previous process's window, so work started by this boot is never misattributed.
 */
export function interruptedTurns(db: Db, observation: BootObservation): InterruptedTurn[] {
  const from = observation.previousBootAt ?? '';
  return db.all<InterruptedTurn>(
    `SELECT r.id AS runId, r.agent_id AS agentId, a.name AS agentName, a.kind AS agentKind,
            a.project_id AS projectId, r.ticket_id AS ticketId, t.identifier AS ticketIdentifier
       FROM runs r
       JOIN agents a ON a.id = r.agent_id
       LEFT JOIN tickets t ON t.id = r.ticket_id
      WHERE r.created_at >= ? AND r.created_at < ?
        AND (r.status = 'running' OR (r.status = 'interrupted' AND r.error_code = 'interrupted_by_shutdown'))
      ORDER BY r.created_at`,
    [from, observation.bootAt],
  );
}

/** `3 s`, `12 min`, `2 h 5 min` — an outage length for one chat line. */
export function formatOutage(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
}

/** `SIGBUS, core dumped` / `killed by SIGKILL` / `exit status 1`, from the service manager's record. */
export function describeExit(exit: ServiceExit): string {
  const signal = exit.signal ?? (exit.exitStatus === null ? 'a signal' : `signal ${exit.exitStatus}`);
  if (exit.exitCode === 'dumped') return `${signal}, core dumped`;
  if (exit.exitCode === 'killed') return `killed by ${signal}`;
  return exit.exitStatus === null ? `exited (${exit.exitCode})` : `exit status ${exit.exitStatus}`;
}

type CrashFields = Partial<Pick<RestartNotice, 'downAt' | 'exit' | 'lastAliveAt'>>;

/**
 * VS-955: what an unclean restart can honestly say about the outage. Only a known `downAt` yields a
 * length; otherwise it says the time is unknown, naming the last liveness instant as a bound.
 */
function crashClause(notice: CrashFields & Pick<RestartNotice, 'bootAt'>): string {
  const how = notice.exit ? ` (${describeExit(notice.exit)})` : '';
  if (notice.downAt) return `${how}; down ${formatOutage(Date.parse(notice.bootAt) - Date.parse(notice.downAt))}`;
  const unknown = notice.exit ? 'when it went down is unknown' : 'when it went down and why are unknown';
  const bound = notice.lastAliveAt ? ` (last alive at ${clockTime(notice.lastAliveAt)})` : '';
  return `${how}; ${unknown}${bound}`;
}

/**
 * The one short line the chat gets. It names when the daemon came back, clean or crash, how many
 * turns are resuming and how many of those are waiting for a run slot, and any failed start — and
 * never claims more than the record holds. For a crash it states the outage only when it is known
 * (VS-955).
 */
export function restartNoticeText(notice: Pick<RestartNotice, 'bootAt' | 'clean' | 'failedStarts' | 'interrupted' | 'queuedForCapacity'> & CrashFields): string {
  const at = clockTime(notice.bootAt);
  const head = notice.clean ? `Back up at ${at} after a restart.` : `Back up at ${at} after an unclean shutdown${crashClause(notice)}.`;
  const n = notice.interrupted.length;
  const queued = notice.queuedForCapacity.length;
  const turns = n === 0 ? '' : ` ${n} ${n === 1 ? 'turn is' : 'turns are'} resuming${queued === 0 ? '' : `; ${queued} ${queued === 1 ? 'is' : 'are'} waiting for a run slot`}.`;
  const failed = notice.failedStarts.count === 0
    ? ''
    : ` ${notice.failedStarts.count} start ${notice.failedStarts.count === 1 ? 'attempt' : 'attempts'} failed before this one.`;
  return `${head}${turns}${failed}`;
}

/** The wake's `reason`: the headline the weaver sees in its inbox before it reads the payload. */
export function restartNoticeReason(notice: Pick<RestartNotice, 'bootAt' | 'clean'> & Partial<Pick<RestartNotice, 'exit'>>): string {
  const at = clockTime(notice.bootAt);
  const how = notice.exit ? ` (${describeExit(notice.exit)})` : '';
  return notice.clean
    ? `The daemon restarted and is back up at ${at}`
    : `The daemon restarted after an unclean shutdown${how} and is back up at ${at}`;
}

/**
 * VS-955: the time and source the notice may state as `downAt` — the previous process's own recorded
 * shutdown, else the service manager's record of its exit, else nothing.
 */
export function resolveDownAt(observation: BootObservation, exit: ServiceExit | null): Pick<RestartNotice, 'downAt' | 'downAtSource'> {
  if (observation.clean && observation.downAt) return { downAt: observation.downAt, downAtSource: 'recorded_shutdown' };
  const exitedAt = exit?.exitedAt ?? null;
  // The journal entry must belong to the previous process's window to be its exit.
  if (exitedAt && observation.previousBootAt && exitedAt >= observation.previousBootAt && exitedAt <= observation.bootAt) {
    return { downAt: exitedAt, downAtSource: 'service_manager' };
  }
  return { downAt: null, downAtSource: null };
}

const uniqueWorkspaces = (workspaces: Map<string, WorkspaceRuntime>): WorkspaceRuntime[] => [...new Set(workspaces.values())];

/** Claim the announcement for one boot. The channel must post one line and enqueue one wake, no more. */
function claimAnnouncement(db: Db, bootAt: string): boolean {
  if (meta(db, KEYS.announcedFor) === bootAt) return false;
  setMeta(db, KEYS.announcedFor, bootAt);
  return true;
}

/**
 * The workspace's own run and project limits, as `queuedForCapacity` needs them. One slot is reserved
 * for the weaver, whose restart wake this same announcement enqueues.
 */
function capacityLimitsFor(w: WorkspaceRuntime, turns: InterruptedTurn[]): CapacityLimits {
  const projectIds = new Set(turns.map((t) => t.projectId).filter((id): id is string => id !== null));
  const projectMaxWorkers = new Map<string, number>();
  for (const projectId of projectIds) {
    const row = w.ctx.db.get<{ maxWorkers: number }>('SELECT max_workers AS maxWorkers FROM projects WHERE id = ?', [projectId]);
    if (row) projectMaxWorkers.set(projectId, row.maxWorkers);
  }
  return { runLimit: w.ctx.config.defaults.maxConcurrentRuns ?? 6, reserved: 1, projectMaxWorkers };
}

/**
 * Tell each workspace. Skipped entirely on the first boot (there is nothing to announce) and on an
 * upgrade restart, which the release comparison upstream has already excluded. Nothing here is fatal
 * to the boot: one unreachable workspace must not stop the others.
 */
export async function announceRestart(deps: {
  db: Db;
  workspaces: Map<string, WorkspaceRuntime>;
  observation: BootObservation;
  /** VS-955: the service manager's record of an invocation's exit; injected by tests. */
  readExit?: (invocationId: string) => Promise<ServiceExit | null>;
}): Promise<void> {
  const { observation } = deps;
  if (observation.previousBootAt === null) return;
  if (!claimAnnouncement(deps.db, observation.bootAt)) return;
  let exit: ServiceExit | null = null;
  if (!observation.clean && observation.previousInvocationId) {
    try { exit = await (deps.readExit ?? readServiceExit)(observation.previousInvocationId); }
    catch (e) { log.warn({ err: String(e) }, 'could not read how the previous process exited'); }
  }
  const down = resolveDownAt(observation, exit);
  for (const w of uniqueWorkspaces(deps.workspaces)) {
    try {
      const interrupted = interruptedTurns(w.ctx.db, observation);
      const notice: RestartNotice = {
        kind: 'daemon.restarted',
        bootAt: observation.bootAt,
        previousBootAt: observation.previousBootAt,
        ...down,
        shutdownReason: observation.clean ? observation.shutdownReason : null,
        clean: observation.clean,
        lastAliveAt: observation.lastAliveAt,
        exit,
        failedStarts: observation.failedStarts,
        interrupted,
        queuedForCapacity: queuedForCapacity(interrupted, capacityLimitsFor(w, interrupted)),
      };
      await w.services.threads.notifyHuman({ kind: 'system', id: null }, { text: restartNoticeText(notice) });
      const weaver = await w.services.workers.ensureConductor();
      w.services.wake.enqueue(weaver.id, {
        source: 'system',
        reason: restartNoticeReason(notice),
        payload: { ...notice },
        idempotencyKey: `daemon.restarted:${observation.bootAt}`,
        requestedBy: { kind: 'system', id: null },
      });
    } catch (e) {
      log.warn({ err: String(e), workspaceId: w.id }, 'could not announce the restart to a workspace');
    }
  }
}

/** Exposed so a test can build the observation without a daemon clock. */
export const restartNoticeNow = nowIso;
