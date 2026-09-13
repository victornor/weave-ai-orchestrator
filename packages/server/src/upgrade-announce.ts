/**
 * What a finished upgrade tells the workspace (VS-76, `daemon-upgrade/upgrade-announcement`).
 *
 * The daemon that comes back after an upgrade is the only process that can report it: the one that
 * started it is gone, and the `upgrades` row is the only thing that crossed the restart. This module is
 * the reading half — the release pair, the window of work the new release contains, the health checks,
 * the payload and the one line the human gets. Everything here is a function of facts already recorded,
 * so it is tested without a daemon, a release directory or a channel.
 *
 * The effectful half lives in `upgrade.ts`: claiming the row through `announced_at`, posting the line
 * and enqueuing the conductor's wake.
 */
import type {
  Upgrade, UpgradeAnnouncement, UpgradeHealthCheck, UpgradeRelease,
} from '@weave-ai/shared';

/** At most this many landed tickets travel in one announcement; the changelog holds the rest. */
export const ANNOUNCED_TICKETS = 20;

/** At most this many undelivered identifiers are named; the count says the true total (VS-239). */
export const ANNOUNCED_UNDELIVERED = 20;

/** A landed delivery as the announcement names it. */
export interface LandedTicket { identifier: string; title: string; at: string }

/** The per-workspace facts the announcement is built from; every one of them is read, never guessed. */
export interface AnnouncementFacts {
  /** The release this daemon is executing, with the version it reports. */
  running: UpgradeRelease;
  /** The commit each release directory was built from, when it can still be read. */
  shaOf(release: string | null): string | null;
  /** Work that landed in this workspace inside the release window. */
  landed(window: { since: string | null; until: string }): LandedTicket[];
  /**
   * Ticket identifiers named at the start of a commit subject between two commits, restricted to this
   * workspace's own ticket prefix — a diagnostic only, never a second source for the landed list
   * itself (VS-239). Empty whenever either commit is missing or the release's history cannot be read.
   */
  commitTicketRefs(from: string | null, to: string | null): string[];
  /**
   * The turns the restart recorded as interrupted in the given window, and how many of those turns'
   * own wakes are now queued to start again (VS-339). This is read from the records finalize and boot
   * recovery wrote, not from a snapshot taken before the restart, so the two counts agree with what
   * actually happened.
   */
  interrupted(window: { since: string | null; until: string }): { interrupted: number; resumed: number };
  /** The migration files a release directory carries, in order; empty when it cannot be read. */
  migrationsIn(release: string | null): string[];
  /**
   * The migration files the databases record as applied, from their durable `meta` rows — not this
   * process's in-memory `appliedMigrations`, which is empty when an earlier boot ran `migrate`.
   */
  migrationsApplied: string[];
  checks: UpgradeHealthCheck[];
  now: string;
}

/**
 * A release directory is `<stamp>-<sha>` with `<stamp>` in local time (see `@weave-ai/release`),
 * which is the only timestamp a release carries. Read back as an ISO instant so it can be compared with
 * the `created_at` of an activity row.
 */
export function releaseBuiltAt(release: string | null): string | null {
  const name = release?.split('/').pop() ?? '';
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[0-9a-f]{7,40}$/.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const at = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * The window whose landed work the new release contains: from when the previous release was built to
 * when the new one was. A release directory that cannot be dated (a hand-made one, or a rollback target
 * that has been pruned) leaves the window open at that end — `since: null` means "nothing to compare
 * against", and the caller lists nothing rather than listing everything.
 */
export function releaseWindow(row: Upgrade, now: string): { since: string | null; until: string } {
  return { since: releaseBuiltAt(row.fromRelease), until: releaseBuiltAt(row.toRelease) ?? now };
}

/**
 * One entry per ticket, at its most recent landing and newest first. A release window can hold two
 * `landed` activity rows for one ticket — a merge and a retried completion (VS-285) — and neither may
 * be listed twice. Sorting here, not only in the query, keeps the function a fact of its input.
 */
export function dedupeLanded(tickets: LandedTicket[]): LandedTicket[] {
  const byIdentifier = new Map<string, LandedTicket>();
  for (const t of tickets) {
    const previous = byIdentifier.get(t.identifier);
    if (!previous || t.at > previous.at) byIdentifier.set(t.identifier, t);
  }
  return [...byIdentifier.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * The migrations the release window introduced: files the target release carries and the source does
 * not, restricted to those the databases record as applied. Both halves are process-independent — the
 * file delta is read from the release directories and the applied set from durable rows — so a
 * migration applied by an earlier boot is still named. When the source release cannot be read the
 * window is open, and the applied set still bounds the list to migrations the target carries.
 */
export function upgradeMigrations(
  row: Upgrade,
  migrationsIn: (release: string | null) => string[],
  applied: string[],
): string[] {
  const target = migrationsIn(row.toRelease);
  if (target.length === 0) return [];
  const source = new Set(migrationsIn(row.fromRelease));
  const recorded = new Set(applied);
  return target.filter((f) => recorded.has(f) && !source.has(f));
}

/**
 * Whether the announcing daemon is actually executing the upgrade's target: a release-path match, or
 * a commit match when the paths differ (a release can be re-created at a new path from the same commit).
 */
function runningIsTarget(row: Upgrade, running: UpgradeRelease): boolean {
  if (row.toRelease && running.path && row.toRelease === running.path) return true;
  return Boolean(row.toSha && running.sha && row.toSha === running.sha);
}

/**
 * The outcome as the running release decides it, not the record alone. A row recorded `completed` by
 * another process is only `completed` when this daemon is on the target; otherwise the announcement
 * says so with `recorded_completed` and never reads as a successful upgrade. A failure whose target is
 * not the release now executing came back on something else: a rollback.
 */
export function upgradeOutcome(row: Upgrade, running: UpgradeRelease): UpgradeAnnouncement['outcome'] {
  if (row.state === 'completed') return runningIsTarget(row, running) ? 'completed' : 'recorded_completed';
  if (row.toRelease && running.path && row.toRelease !== running.path) return 'rolled_back';
  return 'failed';
}

export function buildAnnouncement(row: Upgrade, facts: AnnouncementFacts): UpgradeAnnouncement {
  const outcome = upgradeOutcome(row, facts.running);
  const window = releaseWindow(row, facts.now);
  const from = { path: row.fromRelease, sha: facts.shaOf(row.fromRelease), version: null };
  // Only a completed upgrade is running its target, so only then does the version belong to it.
  const to = { path: row.toRelease, sha: row.toSha ?? facts.shaOf(row.toRelease), version: outcome === 'completed' ? row.cameBackVersion ?? facts.running.version : null };
  // The full landed set, one entry per ticket and newest first, not the bounded slice below — an
  // identifier past the display cap must still count as accounted for, or the undelivered check would
  // wrongly flag it (VS-239).
  const landed = window.since ? dedupeLanded(facts.landed(window)) : [];
  const landedIds = new Set(landed.map((t) => t.identifier));
  const commitRefs = window.since ? facts.commitTicketRefs(from.sha, to.sha) : [];
  const undeliveredIds = commitRefs.filter((id) => !landedIds.has(id));
  const ticketsOmitted = Math.max(0, landed.length - ANNOUNCED_TICKETS);
  // VS-339: the restart window is the upgrade's own span, not the release window — the interrupted
  // turns finish after the target release was built, at the restart. Read from the records, so the
  // counts can never disagree with what finalize and boot recovery did.
  const interrupted = facts.interrupted({ since: row.startedAt ?? row.requestedAt, until: facts.now });
  return {
    kind: 'daemon.upgraded',
    upgradeId: row.id,
    outcome,
    from,
    to,
    running: facts.running,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    backUpAt: facts.now,
    runs: { drained: row.drainedRuns ?? 0, interrupted: interrupted.interrupted, resumed: interrupted.resumed },
    tickets: landed.slice(0, ANNOUNCED_TICKETS),
    ticketsOmitted,
    undelivered: { count: undeliveredIds.length, identifiers: undeliveredIds.slice(0, ANNOUNCED_UNDELIVERED) },
    migrations: upgradeMigrations(row, facts.migrationsIn, facts.migrationsApplied),
    migrationOutcome: row.migrationOutcome,
    health: { ok: facts.checks.every((c) => c.ok), checks: facts.checks },
    failure: outcome === 'completed' ? null : { reason: row.reason, message: row.message },
  };
}

// ---------- the line the human gets ----------

const shortSha = (sha: string | null): string => (sha ? sha.slice(0, 7) : '');

/** The running version (git sha), a short commit, or the release directory name. Never `v0.1.0`. */
export function releaseLabel(release: UpgradeRelease): string {
  if (release.version && release.version !== 'unknown') return release.version;
  const sha = shortSha(release.sha);
  return sha || release.path?.split('/').pop() || 'an unknown release';
}

/** Local `HH:MM` on the daemon host — the only clock the human and the daemon share. */
export function clockTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const failingChecks = (a: UpgradeAnnouncement): string =>
  a.health.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join(', ');

/**
 * The clause naming a gap between the release's commits and its delivery records (VS-239), or the
 * empty string when there is none — so the completed-upgrade line is unchanged in the normal case.
 */
const undeliveredClause = (a: UpgradeAnnouncement): string => {
  if (a.undelivered.count === 0) return '';
  const noun = a.undelivered.count === 1 ? 'change is' : 'changes are';
  const named = a.undelivered.identifiers.length ? ` (${a.undelivered.identifiers.join(', ')})` : '';
  return ` ${a.undelivered.count} ${noun} in the release without a delivery record${named}.`;
};

/** What the landed cap left out (VS-315); the empty string when it hid nothing. */
const omittedClause = (a: UpgradeAnnouncement): string => {
  if (a.ticketsOmitted === 0) return '';
  return ` ${a.ticketsOmitted} more landed ${a.ticketsOmitted === 1 ? 'ticket' : 'tickets'} not listed.`;
};

/**
 * VS-316: names a service-unit rename that didn't happen — `migrated` and `null` (not applicable) need
 * no separate mention, since the ordinary completed-upgrade line already covers a fully successful
 * upgrade, and this is the only place a `fallback`/`prepare_failed` migration reaches a human.
 */
const migrationClause = (a: UpgradeAnnouncement): string => {
  if (a.migrationOutcome === 'fallback') return ' The service-unit rename to the current name did not take; still running under the old one.';
  if (a.migrationOutcome === 'prepare_failed') return ' Could not even prepare the service-unit rename this time; still running under the old name.';
  return '';
};

/**
 * One line, posted on the primary chat thread. It says what is running and when it came back, and it
 * never claims the system is back up when a check says otherwise — that claim is the whole point of it.
 */
export function announcementText(a: UpgradeAnnouncement): string {
  const at = clockTime(a.backUpAt);
  if (a.outcome === 'completed') {
    const head = `Upgraded to ${releaseLabel(a.to)}`;
    const base = a.health.ok
      ? `${head}, back up at ${at}.`
      : `${head} and restarted at ${at}, but not fully back up: ${failingChecks(a)} failed.`;
    return `${base}${omittedClause(a)}${undeliveredClause(a)}${migrationClause(a)}`;
  }
  if (a.outcome === 'recorded_completed') {
    const head = `The upgrade to ${releaseLabel(a.to)} is recorded completed, but this daemon is running ${releaseLabel(a.running)}`;
    return a.health.ok
      ? `${head}, back up at ${at}.`
      : `${head} at ${at}, and not fully back up: ${failingChecks(a)} failed.`;
  }
  const head = a.outcome === 'rolled_back'
    ? `The upgrade to ${releaseLabel(a.to)} was rolled back`
    : 'The daemon upgrade failed';
  const reason = a.failure?.reason ? ` (${a.failure.reason})` : '';
  const tail = a.health.ok
    ? `Running ${releaseLabel(a.running)}, back up at ${at}.`
    : `Running ${releaseLabel(a.running)} at ${at}, and not fully back up: ${failingChecks(a)} failed.`;
  return `${head}${reason}. ${tail}`;
}

/** The wake's `reason`: the headline the conductor sees in its inbox before it reads the payload. */
export function announcementReason(a: UpgradeAnnouncement): string {
  if (a.outcome === 'completed') return `The daemon upgraded to ${releaseLabel(a.to)} and is back up`;
  if (a.outcome === 'recorded_completed') return `The upgrade to ${releaseLabel(a.to)} is recorded completed, but the daemon is running ${releaseLabel(a.running)}`;
  if (a.outcome === 'rolled_back') return `The daemon upgrade was rolled back; it is running ${releaseLabel(a.running)}`;
  return `The daemon upgrade failed; it is running ${releaseLabel(a.running)}`;
}
