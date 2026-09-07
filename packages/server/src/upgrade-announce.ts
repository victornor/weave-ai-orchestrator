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
} from '@agent-conductor/shared';

/** At most this many landed tickets travel in one announcement; the changelog holds the rest. */
export const ANNOUNCED_TICKETS = 20;

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
  /** Wakes queued in this workspace and waiting for the dispatcher that just started. */
  queuedWakes(): number;
  migrations: string[];
  checks: UpgradeHealthCheck[];
  now: string;
}

/**
 * A release directory is `<stamp>-<sha>` with `<stamp>` in local time (see `@agent-conductor/release`),
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

/** A failure whose target is not the release now executing came back on something else: a rollback. */
export function upgradeOutcome(row: Upgrade, running: UpgradeRelease): UpgradeAnnouncement['outcome'] {
  if (row.state === 'completed') return 'completed';
  if (row.toRelease && running.path && row.toRelease !== running.path) return 'rolled_back';
  return 'failed';
}

export function buildAnnouncement(row: Upgrade, facts: AnnouncementFacts): UpgradeAnnouncement {
  const outcome = upgradeOutcome(row, facts.running);
  const window = releaseWindow(row, facts.now);
  return {
    kind: 'daemon.upgraded',
    upgradeId: row.id,
    outcome,
    from: { path: row.fromRelease, sha: facts.shaOf(row.fromRelease), version: null },
    // Only a completed upgrade is running its target, so only then does the version belong to it.
    to: { path: row.toRelease, sha: row.toSha ?? facts.shaOf(row.toRelease), version: outcome === 'completed' ? row.cameBackVersion ?? facts.running.version : null },
    running: facts.running,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    backUpAt: facts.now,
    runs: { drained: row.drainedRuns ?? 0, resumed: facts.queuedWakes() },
    tickets: window.since ? facts.landed(window).slice(0, ANNOUNCED_TICKETS) : [],
    migrations: facts.migrations,
    health: { ok: facts.checks.every((c) => c.ok), checks: facts.checks },
    failure: outcome === 'completed' ? null : { reason: row.reason, message: row.message },
  };
}

// ---------- the line the human gets ----------

const shortSha = (sha: string | null): string => (sha ? sha.slice(0, 7) : '');

/** `v1.2.0 (a1b2c3d)`, `v1.2.0`, `a1b2c3d`, or the release's directory name when it has neither. */
export function releaseLabel(release: UpgradeRelease): string {
  const version = release.version ? `v${release.version}` : '';
  const sha = shortSha(release.sha);
  if (version && sha) return `${version} (${sha})`;
  return version || sha || release.path?.split('/').pop() || 'an unknown release';
}

/** Local `HH:MM` on the daemon host — the only clock the human and the daemon share. */
export function clockTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const failingChecks = (a: UpgradeAnnouncement): string =>
  a.health.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join(', ');

/**
 * One line, posted on the primary chat thread. It says what is running and when it came back, and it
 * never claims the system is back up when a check says otherwise — that claim is the whole point of it.
 */
export function announcementText(a: UpgradeAnnouncement): string {
  const at = clockTime(a.backUpAt);
  if (a.outcome === 'completed') {
    const head = `Upgraded to ${releaseLabel(a.to)}`;
    return a.health.ok
      ? `${head}, back up at ${at}.`
      : `${head} and restarted at ${at}, but not fully back up: ${failingChecks(a)} failed.`;
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
  if (a.outcome === 'rolled_back') return `The daemon upgrade was rolled back; it is running ${releaseLabel(a.running)}`;
  return `The daemon upgrade failed; it is running ${releaseLabel(a.running)}`;
}
