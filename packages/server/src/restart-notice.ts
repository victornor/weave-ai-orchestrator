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
import type { RestartNotice } from '@weave-ai/shared';
import type { WorkspaceRuntime } from './types.js';
import { clockTime } from './upgrade-announce.js';

const log = getLogger('daemon', { component: 'restart-notice' });

/** The daemon database's lifecycle keys. All under one prefix so nothing else collides. */
const KEYS = {
  bootAt: 'daemon.lifecycle.boot_at',
  bootRelease: 'daemon.lifecycle.boot_release',
  bootPid: 'daemon.lifecycle.boot_pid',
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
  /** When the previous process recorded a deliberate shutdown; null when it crashed. */
  downAt: string | null;
  shutdownReason: string | null;
  /** True only when the previous process recorded a shutdown at or after its own boot. */
  clean: boolean;
  failedStarts: { count: number; lastAt: string | null; lastReason: string | null };
}

/** A turn the previous shutdown cut off, named the way the weaver's wake carries it. */
export interface InterruptedTurn {
  runId: string;
  agentId: string;
  agentName: string;
  agentKind: string;
  ticketId: string | null;
  ticketIdentifier: string | null;
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
 */
export function observeBoot(db: Db, opts: { now: string; release: string | null; pid: number | null }): BootObservation {
  const previousBootAt = meta(db, KEYS.bootAt);
  const previousBootRelease = meta(db, KEYS.bootRelease);
  const downAt = meta(db, KEYS.shutdownAt);
  const shutdownReason = meta(db, KEYS.shutdownReason);
  const count = Number(meta(db, KEYS.failedStartCount) ?? 0);
  return {
    bootAt: opts.now,
    previousBootAt,
    previousBootRelease,
    downAt,
    shutdownReason,
    clean: previousBootAt !== null && downAt !== null && downAt >= previousBootAt,
    failedStarts: {
      count: Number.isFinite(count) && count > 0 ? count : 0,
      lastAt: meta(db, KEYS.failedStartAt),
      lastReason: meta(db, KEYS.failedStartReason),
    },
  };
}

/** Record that this process is serving: its boot instant, release and pid; reset the failed-start count. */
export function markBooted(db: Db, opts: { now: string; release: string | null; pid: number | null }): void {
  setMeta(db, KEYS.bootAt, opts.now);
  if (opts.release !== null) setMeta(db, KEYS.bootRelease, opts.release);
  if (opts.pid !== null) setMeta(db, KEYS.bootPid, String(opts.pid));
  setMeta(db, KEYS.failedStartCount, '0');
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
            r.ticket_id AS ticketId, t.identifier AS ticketIdentifier
       FROM runs r
       JOIN agents a ON a.id = r.agent_id
       LEFT JOIN tickets t ON t.id = r.ticket_id
      WHERE r.created_at >= ? AND r.created_at < ?
        AND (r.status = 'running' OR (r.status = 'interrupted' AND r.error_code = 'interrupted_by_shutdown'))
      ORDER BY r.created_at`,
    [from, observation.bootAt],
  );
}

/**
 * The one short line the chat gets. It names when the daemon came back, clean or crash, how many
 * turns are resuming, and any failed start — and never claims more than the record holds.
 */
export function restartNoticeText(notice: Pick<RestartNotice, 'bootAt' | 'clean' | 'failedStarts' | 'interrupted'>): string {
  const at = clockTime(notice.bootAt);
  const head = notice.clean ? `Back up at ${at} after a restart.` : `Back up at ${at} after an unclean shutdown.`;
  const n = notice.interrupted.length;
  const turns = n === 0 ? '' : ` ${n} ${n === 1 ? 'turn is' : 'turns are'} resuming.`;
  const failed = notice.failedStarts.count === 0
    ? ''
    : ` ${notice.failedStarts.count} start ${notice.failedStarts.count === 1 ? 'attempt' : 'attempts'} failed before this one.`;
  return `${head}${turns}${failed}`;
}

/** The wake's `reason`: the headline the weaver sees in its inbox before it reads the payload. */
export function restartNoticeReason(notice: Pick<RestartNotice, 'bootAt' | 'clean'>): string {
  const at = clockTime(notice.bootAt);
  return notice.clean
    ? `The daemon restarted and is back up at ${at}`
    : `The daemon restarted after an unclean shutdown and is back up at ${at}`;
}

const uniqueWorkspaces = (workspaces: Map<string, WorkspaceRuntime>): WorkspaceRuntime[] => [...new Set(workspaces.values())];

/** Claim the announcement for one boot. The channel must post one line and enqueue one wake, no more. */
function claimAnnouncement(db: Db, bootAt: string): boolean {
  if (meta(db, KEYS.announcedFor) === bootAt) return false;
  setMeta(db, KEYS.announcedFor, bootAt);
  return true;
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
}): Promise<void> {
  const { observation } = deps;
  if (observation.previousBootAt === null) return;
  if (!claimAnnouncement(deps.db, observation.bootAt)) return;
  for (const w of uniqueWorkspaces(deps.workspaces)) {
    try {
      const notice: RestartNotice = {
        kind: 'daemon.restarted',
        bootAt: observation.bootAt,
        previousBootAt: observation.previousBootAt,
        downAt: observation.downAt,
        shutdownReason: observation.shutdownReason,
        clean: observation.clean,
        failedStarts: observation.failedStarts,
        interrupted: interruptedTurns(w.ctx.db, observation),
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
