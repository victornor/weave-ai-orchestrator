/**
 * The restart half of a deferred daemon upgrade (PLAN §20).
 *
 * The daemon does everything up to and including the `current` symlink swing, then hands off to this:
 * a detached process started from the **new** release, so a release that changed the runner ships its
 * own. It restarts the daemon, waits for a healthy one running the target release, and — if that never
 * happens — swings `current` back to `previous` and restarts again. It writes its verdict straight into
 * `daemon.sqlite`, because the daemon it would otherwise ask is the one being restarted.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDb, nowIso, type Db } from '@agent-conductor/db';
import type { Upgrade } from '@agent-conductor/shared';
import { planRestart, previousLink, readLink, switchRelease } from '@agent-conductor/release';
import { configHome } from './contexts.js';
import { launchdPlistPath, serviceUnitPath, startDaemon, stopDaemon } from './daemon.js';

/** How long the new daemon has to come back healthy on the target release before it is rolled back. */
export const HEALTH_DEADLINE_MS = 90_000;
const PROBE_INTERVAL_MS = 1000;

export interface HealthProbe {
  ok: boolean;
  version: string | null;
  /** The release the daemon that answered is executing. */
  releasePath: string | null;
  releaseSha: string | null;
}

export interface RunnerIo {
  /** Restart the daemon. Resolves once the restart has been *requested*, not once it is healthy. */
  restart(): Promise<void>;
  /** One health request; `null` when nothing answered. */
  probe(): Promise<HealthProbe | null>;
  /** Put `current` back to the release named, for the rollback path. */
  rollbackTo(release: string): void;
  previousRelease(): string | null;
  now(): number;
  sleep(ms: number): Promise<void>;
  /**
   * Whether the daemon's own boot-time reconciliation has already recorded this upgrade completed
   * (VS-115) — a fact only the daemon process itself ever writes, and only once its own release
   * directory matches the target. Checked alongside the HTTP health probe because that probe can time
   * out on a transient hiccup even though the daemon is in fact healthy on target; reconciliation is
   * the faster and more reliable signal, so it takes priority and the runner never rolls back once it
   * has fired.
   */
  alreadyCompleted(): Promise<boolean>;
}

export type RunnerVerdict =
  | { outcome: 'completed'; version: string | null }
  | { outcome: 'rolled_back'; to: string | null; message: string }
  | { outcome: 'gone'; message: string };

/**
 * Restart, verify, and roll back if the target never answers. Pure with respect to the host: every
 * effect goes through `io`, which is why this is the part that is tested.
 */
export async function driveRestart(target: { release: string; sha: string | null }, io: RunnerIo): Promise<RunnerVerdict> {
  const previous = io.previousRelease();
  await io.restart();

  const deadline = io.now() + HEALTH_DEADLINE_MS;
  while (io.now() < deadline) {
    const health = await io.probe();
    if (health?.ok && onTarget(health, target)) return { outcome: 'completed', version: health.version };
    // The daemon's own boot-time reconciliation beat this probe to a verdict: trust it over a probe
    // that has not (yet) answered, rather than rolling back a release that is in fact serving.
    if (await io.alreadyCompleted()) return { outcome: 'completed', version: null };
    await io.sleep(PROBE_INTERVAL_MS);
  }

  if (!previous) {
    return { outcome: 'gone', message: `no daemon came back on ${target.release} and there is no previous release to fall back to` };
  }
  io.rollbackTo(previous);
  await io.restart();
  return { outcome: 'rolled_back', to: previous, message: `no healthy daemon on ${target.release} within ${HEALTH_DEADLINE_MS / 1000}s; rolled back to ${previous}` };
}

/** The daemon that answered is the one the upgrade switched to — by directory, or by the commit it was built from. */
function onTarget(health: HealthProbe, target: { release: string; sha: string | null }): boolean {
  if (health.releasePath && health.releasePath === target.release) return true;
  return Boolean(target.sha && health.releaseSha && health.releaseSha === target.sha);
}

// ---------- writing the verdict ----------

/**
 * Guarded on the record still being `restarting` (VS-115): a verdict decided after the record has
 * already reached a terminal state — by reconciliation, or by an earlier call racing this one — must
 * not overwrite it. `recordVerdict` is not the only writer of this row's terminal state; `reconcile()`
 * (`packages/server/src/upgrade.ts`) is the other, and this guard is what keeps whichever one is
 * slower from clobbering the one that already landed.
 */
export function recordVerdict(db: Db, upgradeId: string, verdict: RunnerVerdict): void {
  const finishedAt = nowIso();
  if (verdict.outcome === 'completed') {
    db.run(
      "UPDATE upgrades SET state = 'completed', finished_at = ?, came_back_version = ?, reason = NULL, message = NULL WHERE id = ? AND state = 'restarting'",
      [finishedAt, verdict.version, upgradeId],
    );
    return;
  }
  const reason = verdict.outcome === 'rolled_back' ? 'restart_failed' : 'restart_unverified';
  db.run(
    "UPDATE upgrades SET state = 'failed', finished_at = ?, reason = ?, message = ? WHERE id = ? AND state = 'restarting'",
    [finishedAt, reason, verdict.message, upgradeId],
  );
}

// ---------- the host-facing wiring ----------

function healthUrl(config: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(config, 'daemon.json'), 'utf8')) as { publicUrl?: string; loopbackUrl?: string };
    return raw.loopbackUrl ?? raw.publicUrl ?? null;
  } catch {
    return null;
  }
}

function restartCommand(): { how: string; run: () => Promise<void> } {
  const plan = planRestart({
    platform: process.platform,
    unitInstalled: existsSync(serviceUnitPath()),
    launchdInstalled: existsSync(launchdPlistPath()),
    // Only `plan.restart` is read here; how the runner itself was launched was decided by the daemon.
    systemdRunAvailable: true,
    uid: process.getuid?.(),
  });
  if (!plan.restart) {
    return { how: plan.how, run: async () => { await stopDaemon(); startDaemon({}); } };
  }
  const { cmd, args } = plan.restart;
  return { how: plan.how, run: async () => { spawnSync(cmd, args, { encoding: 'utf8' }); } };
}

/** `conductor daemon upgrade-runner <upgradeId>`: hidden, started by the daemon, never by a human. */
export async function runUpgradeRunner(upgradeId: string): Promise<RunnerVerdict> {
  const config = configHome();
  const db = openDb(join(config, 'daemon.sqlite'));
  try {
    const row = db.get<Upgrade>('SELECT * FROM upgrades WHERE id = ?', [upgradeId]);
    if (!row || row.state !== 'restarting' || !row.toRelease) {
      return { outcome: 'gone', message: `upgrade ${upgradeId} is not waiting for a restart` };
    }
    const restart = restartCommand();
    const verdict = await driveRestart({ release: row.toRelease, sha: row.toSha }, {
      restart: restart.run,
      probe: async () => {
        const base = healthUrl(config);
        if (!base) return null;
        try {
          const res = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(3000) });
          if (!res.ok) return null;
          const body = await res.json() as { ok?: boolean; version?: string; release?: { path?: string; sha?: string | null } };
          return { ok: Boolean(body.ok), version: body.version ?? null, releasePath: body.release?.path ?? null, releaseSha: body.release?.sha ?? null };
        } catch {
          return null;
        }
      },
      rollbackTo: (release) => { switchRelease(release); },
      previousRelease: () => readLink(previousLink()),
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      alreadyCompleted: async () => db.get<{ state: string }>('SELECT state FROM upgrades WHERE id = ?', [upgradeId])?.state === 'completed',
    });
    recordVerdict(db, upgradeId, verdict);
    return verdict;
  } finally {
    db.close();
  }
}
