/**
 * The restart half of a deferred daemon upgrade (PLAN §20).
 *
 * The daemon does everything up to and including the `current` symlink swing, then hands off to this:
 * a detached process started from the **new** release, so a release that changed the runner ships its
 * own. It restarts the daemon, waits for a healthy one running the target release, and — if that never
 * happens — swings `current` back to `previous` and restarts again. It writes its verdict straight into
 * `daemon.sqlite`, because the daemon it would otherwise ask is the one being restarted.
 */
import { cpSync, existsSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDb, nowIso, type Db } from '@weave-ai/db';
import type { Upgrade } from '@weave-ai/shared';
import {
  LAUNCHD_LABEL, SERVICE_NAME, planRestart, previousLink, readLink, resolveInstalledLaunchdAgent,
  resolveInstalledUnit, switchRelease, type InstalledLaunchdAgent, type InstalledUnit,
} from '@weave-ai/release';
import { configHome } from './contexts.js';
import { startDaemon, stopDaemon } from './daemon.js';

/** How long the new daemon has to come back healthy on the target release before it is rolled back. */
export const HEALTH_DEADLINE_MS = 90_000;
const PROBE_INTERVAL_MS = 1000;

export interface HealthProbe {
  ok: boolean;
  version: string | null;
  /** The release the daemon that answered is executing. */
  releasePath: string | null;
  releaseSha: string | null;
  /** VS-316: the pid of the process that answered, so the caller can confirm it is the one replaced. */
  pid: number | null;
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
  /**
   * VS-316: whether `pid` (the pid a health probe answered with) is confirmed to be the process that
   * replaced the one being restarted — not merely a daemon that happens to answer on the target
   * release. `true`/`false` are definite; `null` means this host cannot tell either way, in which case
   * the release-and-health match alone is trusted, unchanged from before this existed.
   */
  confirmsReplacement(pid: number): Promise<boolean | null>;
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
    if (health?.ok && onTarget(health, target)) {
      // VS-316: a probe on the target release alone is not proof — it might be a stray process running
      // the new code rather than the service that was actually restarted. Only an explicit `false`
      // rejects this probe; `true` and `null` (host can't tell) are both accepted, matching the
      // pre-existing release-match-only behavior when confirmation isn't possible.
      const confirmed = health.pid === null ? null : await io.confirmsReplacement(health.pid);
      if (confirmed !== false) return { outcome: 'completed', version: health.version };
    }
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
export type MigrationOutcome = 'migrated' | 'fallback' | 'prepare_failed' | null;

export function recordVerdict(db: Db, upgradeId: string, verdict: RunnerVerdict, migrationOutcome: MigrationOutcome = null): void {
  const finishedAt = nowIso();
  if (verdict.outcome === 'completed') {
    db.run(
      "UPDATE upgrades SET state = 'completed', finished_at = ?, came_back_version = ?, reason = NULL, message = NULL, migration_outcome = ? WHERE id = ? AND state = 'restarting'",
      [finishedAt, verdict.version, migrationOutcome, upgradeId],
    );
    return;
  }
  const reason = verdict.outcome === 'rolled_back' ? 'restart_failed' : 'restart_unverified';
  db.run(
    "UPDATE upgrades SET state = 'failed', finished_at = ?, reason = ?, message = ?, migration_outcome = ? WHERE id = ? AND state = 'restarting'",
    [finishedAt, reason, verdict.message, migrationOutcome, upgradeId],
  );
}

/**
 * VS-316: the restart command itself never even got to try (`restartCommand().run()` threw before
 * `driveRestart` could act). No verdict was ever computed, so this writes directly rather than going
 * through `recordVerdict` — same guard, so a race against a genuine verdict from elsewhere still can't
 * double-write.
 */
export function recordRestartCommandFailure(db: Db, upgradeId: string, message: string, migrationOutcome: MigrationOutcome = null): void {
  db.run(
    "UPDATE upgrades SET state = 'failed', finished_at = ?, reason = 'restart_failed', message = ?, migration_outcome = ? WHERE id = ? AND state = 'restarting'",
    [nowIso(), message.slice(0, 2000), migrationOutcome, upgradeId],
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

async function probeHealth(base: string): Promise<HealthProbe | null> {
  try {
    const res = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = await res.json() as { ok?: boolean; version?: string; pid?: number; release?: { path?: string; sha?: string | null } };
    return {
      ok: Boolean(body.ok), version: body.version ?? null,
      releasePath: body.release?.path ?? null, releaseSha: body.release?.sha ?? null,
      pid: typeof body.pid === 'number' ? body.pid : null,
    };
  } catch {
    return null;
  }
}

// ---------- the seam every real command/proc-read goes through (VS-316, design.md "Testing this safely") ----------

export interface CommandResult { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; error?: Error }
/** One command, run and captured — never a real `systemctl`/`launchctl` invocation in a test. */
export type RunCommand = (cmd: string, args: string[]) => CommandResult;
/** One `/proc/<pid>/cgroup` read — never a real one in a test. */
export type ReadCgroup = (pid: number) => string;

export interface HostIo { run: RunCommand; readCgroup: ReadCgroup }

const realRun: RunCommand = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
};
const realReadCgroup: ReadCgroup = (pid) => readFileSync(`/proc/${pid}/cgroup`, 'utf8');
export const realHostIo: HostIo = { run: realRun, readCgroup: realReadCgroup };

/** systemd's own record of who is running a unit right now — the fast path for `confirmsReplacement`. */
function systemdMainPid(unitName: string, run: RunCommand): number | null {
  const r = run('systemctl', ['--user', 'show', unitName, '--property=MainPID', '--value']);
  if (r.error || r.status !== 0) return null;
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Whether `pid`'s own cgroup names `unitName` — the fallback for a service whose `ExecStart` is a
 * wrapper that doesn't `exec` into the final process, so `MainPID` alone would reject it. `null` when
 * it cannot be read at all (no `/proc`, permission, the pid is already gone) rather than assumed false.
 */
function cgroupNamesUnit(pid: number, unitName: string, readCgroup: ReadCgroup): boolean | null {
  try {
    return readCgroup(pid).includes(unitName);
  } catch {
    return null;
  }
}

/** VS-316, Decision 3: `MainPID` equality first; a definite negative there falls back to the cgroup check. */
function confirmsReplacementViaSystemd(unitName: string, pid: number, io: HostIo): boolean | null {
  const mainPid = systemdMainPid(unitName, io.run);
  if (mainPid !== null) {
    if (pid === mainPid) return true;
    const cgroup = cgroupNamesUnit(pid, unitName, io.readCgroup);
    return cgroup === null ? false : cgroup;
  }
  return cgroupNamesUnit(pid, unitName, io.readCgroup);
}

/** Best-effort launchd counterpart: `launchctl print` names the pid it thinks owns the label. */
function launchdPid(label: string, uid: number, run: RunCommand): number | null {
  const r = run('launchctl', ['print', `gui/${uid}/${label}`]);
  if (r.error || r.status !== 0) return null;
  const m = /\bpid\s*=\s*(\d+)/.exec(r.stdout);
  return m?.[1] ? Number.parseInt(m[1], 10) : null;
}

export interface RestartOutcome {
  how: string;
  /** Requests the restart. Throws on a command that failed to start or exited non-zero (VS-316). */
  run(): Promise<void>;
  /** VS-316: confirms a probe's pid against whichever mechanism this restart path can use. */
  confirmsReplacement(pid: number): Promise<boolean | null>;
  /** VS-316: non-null only once a unit migration has been attempted by `run()`. */
  migrationOutcome(): 'migrated' | 'fallback' | 'prepare_failed' | null;
  /**
   * VS-316: retires the pre-rename unit/agent. Call only once the upgrade's own verdict is
   * `completed` — a no-op unless this restart's cutover actually succeeded.
   */
  finalizeMigration(): Promise<void>;
}

const notMigrating: Pick<RestartOutcome, 'migrationOutcome' | 'finalizeMigration'> = {
  migrationOutcome: () => null,
  finalizeMigration: async () => { /* nothing to finalize */ },
};

/** `Description=` is the only field a migrated unit's content changes; everything else is carried as-is. */
function withCurrentDescription(unitContent: string): string {
  const line = 'Description=Weave AI daemon';
  return /^Description=.*$/m.test(unitContent)
    ? unitContent.replace(/^Description=.*$/m, line)
    : unitContent.replace(/^\[Unit\]$/m, `[Unit]\n${line}`);
}

/**
 * VS-316, Decision 4 (revised per PR #265 review): migrate `legacyUnit` to `SERVICE_NAME`, then restart
 * under whichever name ends up active. Three phases: prepare (files only, nothing running touched),
 * cutover (stop legacy, start new), and `finalizeMigration()` (retiring the legacy unit — called by the
 * caller only once the whole upgrade verifies `completed`).
 *
 * Every path that does **not** end the upgrade with the new unit committed — `prepare_failed`,
 * `fallback`, and a cutover that succeeded but the release itself never verified (the
 * `HEALTH_DEADLINE_MS` rollback calling `run()` a second time) — undoes whatever `prepare` wrote before
 * returning. Left in place, a stale-but-present `weave-ai.service` file would make a *later* upgrade's
 * `resolveInstalledUnit()` (now legacy-preferring, the same review's other fix) still see it and, on
 * some future call path, trust a unit nothing ever actually finished switching to — recreating exactly
 * the two-daemons shape this ticket exists to remove. `resolveInstalledUnit()` alone is not enough:
 * leaving the file behind, even disabled, means an operator inspecting the host — or a differently-timed
 * future upgrade — finds it. Belt and suspenders.
 */
function migrateSystemdUnit(legacyUnit: InstalledUnit, io: HostIo): RestartOutcome {
  let outcome: 'migrated' | 'fallback' | 'prepare_failed' | null = null;
  let activeUnitName = legacyUnit.name;
  let cutoverSucceeded = false;
  let attempted = false;
  const newUnitPath = join(legacyUnit.path, '..', SERVICE_NAME);
  const legacyDropIn = `${legacyUnit.path}.d`;
  const newDropIn = `${newUnitPath}.d`;

  const restartUnit = (name: string): void => {
    const r = io.run('systemctl', ['--user', 'restart', name]);
    if (r.error) throw new Error(`systemctl failed to start: ${r.error.message}`);
    if (r.status !== 0) {
      const detail = (r.stderr || r.stdout).trim().slice(0, 2000);
      throw new Error(`systemctl --user restart ${name} exited ${String(r.status ?? r.signal)}${detail ? `: ${detail}` : ''}`);
    }
  };

  /** Removes whatever `prepare` wrote for the new unit — every path that isn't finalized calls this. */
  const undoPrepare = (): void => {
    // Stop first, in case cutover ever actually started it (PR #265 review, round 2) — "not loaded" or
    // "inactive" is an expected, harmless outcome here and its result is not checked.
    io.run('systemctl', ['--user', 'stop', SERVICE_NAME]);
    io.run('systemctl', ['--user', 'disable', SERVICE_NAME]); // "not enabled" is fine; result unchecked
    try { if (existsSync(newUnitPath)) unlinkSync(newUnitPath); } catch { /* best-effort */ }
    try { if (existsSync(newDropIn)) rmSync(newDropIn, { recursive: true, force: true }); } catch { /* best-effort */ }
    io.run('systemctl', ['--user', 'daemon-reload']);
  };

  return {
    how: `migrate ${legacyUnit.name} to ${SERVICE_NAME}, then restart`,
    run: async () => {
      if (attempted) {
        // A later call is the HEALTH_DEADLINE_MS deadline's rollback restart. If cutover had
        // succeeded, the release itself never verified — revert the unit migration too, rather than
        // leave two units enabled (one running the rolled-back release, one stale): bring the daemon
        // back under the legacy unit first, so exactly one is ever live, then remove the new one.
        if (cutoverSucceeded) {
          // Never start legacy back up unless the new unit is confirmed stopped first — the same
          // "stop must succeed before start" rule as the cutover below, so this can never leave both
          // live either.
          const stopNew = io.run('systemctl', ['--user', 'stop', SERVICE_NAME]);
          const startLegacy = stopNew.status === 0 ? io.run('systemctl', ['--user', 'start', legacyUnit.name]) : null;
          if (!startLegacy || startLegacy.status !== 0) {
            throw new Error(`could not revert the unit migration after the release failed to verify (${legacyUnit.name} did not come back up)`);
          }
          activeUnitName = legacyUnit.name;
          cutoverSucceeded = false;
          outcome = 'fallback';
          undoPrepare();
          return;
        }
        return restartUnit(activeUnitName);
      }
      attempted = true;

      try {
        writeFileSync(newUnitPath, withCurrentDescription(readFileSync(legacyUnit.path, 'utf8')));
        if (existsSync(legacyDropIn)) cpSync(legacyDropIn, newDropIn, { recursive: true });
        const reload = io.run('systemctl', ['--user', 'daemon-reload']);
        if (reload.status !== 0) throw new Error(`daemon-reload failed: ${(reload.stderr || reload.stdout).trim()}`);
        const enable = io.run('systemctl', ['--user', 'enable', SERVICE_NAME]);
        if (enable.status !== 0) throw new Error(`enable failed: ${(enable.stderr || enable.stdout).trim()}`);
      } catch (e) {
        outcome = 'prepare_failed';
        undoPrepare();
        try {
          restartUnit(legacyUnit.name); // still legacy — prepare never touched anything running
        } catch (restartErr) {
          throw new Error(`unit migration prepare failed (${(e as Error).message}), and the fallback restart also failed: ${(restartErr as Error).message}`);
        }
        return;
      }

      // Never attempt to start the new unit unless the legacy one is confirmed stopped first (PR #265
      // review, round 2) — otherwise a legacy stop that fails (a cancelled or failed stop job) while
      // the new unit's start happens to succeed leaves both running.
      const stop = io.run('systemctl', ['--user', 'stop', legacyUnit.name]);
      const start = stop.status === 0 ? io.run('systemctl', ['--user', 'start', SERVICE_NAME]) : null;
      if (start && start.status === 0) {
        activeUnitName = SERVICE_NAME;
        cutoverSucceeded = true;
        outcome = 'migrated';
        return;
      }
      outcome = 'fallback';
      const fallback = io.run('systemctl', ['--user', 'start', legacyUnit.name]);
      undoPrepare();
      if (fallback.status !== 0) {
        throw new Error(`migration cutover to ${SERVICE_NAME} failed, and bringing ${legacyUnit.name} back up also failed`);
      }
      // activeUnitName stays legacyUnit.name; the upgrade proceeds to verify against it, unmigrated.
    },
    confirmsReplacement: async (pid) => confirmsReplacementViaSystemd(activeUnitName, pid, io),
    migrationOutcome: () => outcome,
    finalizeMigration: async () => {
      if (!cutoverSucceeded) return;
      io.run('systemctl', ['--user', 'disable', legacyUnit.name]);
      try {
        renameSync(legacyUnit.path, `${legacyUnit.path}.migrated`);
        if (existsSync(legacyDropIn)) renameSync(legacyDropIn, `${legacyDropIn}.migrated`);
      } catch { /* best-effort: the legacy unit is already disabled and inactive either way */ }
      io.run('systemctl', ['--user', 'daemon-reload']);
    },
  };
}

/**
 * A plist has no `Description=` line — `Label` is the field that must change, since it is what
 * `launchctl` addresses the job by. Left as the legacy label (PR #265 review), the copy at
 * `com.weave-ai.daemon.plist` would still answer to `com.agent-conductor.daemon`, so `bootstrap`,
 * `launchdPid` and a rollback `kickstart` would all address a label nothing has registered.
 */
function withCurrentLabel(plistContent: string): string {
  return plistContent.replace(/(<key>Label<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${LAUNCHD_LABEL}$2`);
}

/**
 * Best-effort launchd mirror of `migrateSystemdUnit` — see design.md's Non-Goals: no macOS CI here.
 * Same undo-on-every-non-finalizing-path rule; simpler than systemd's, since launchd has no separate
 * "enabled but not started" state — `bootstrap` either fully loads and starts the job or fails outright,
 * so there is nothing to `disable`, only the copied plist file itself to remove.
 */
export function migrateLaunchdAgent(legacyAgent: InstalledLaunchdAgent, io: HostIo): RestartOutcome {
  let outcome: 'migrated' | 'fallback' | 'prepare_failed' | null = null;
  let activeLabel = legacyAgent.label;
  let cutoverSucceeded = false;
  let attempted = false;
  const uid = process.getuid?.() ?? 0;
  const newPath = join(legacyAgent.path, '..', `${LAUNCHD_LABEL}.plist`);
  const target = (label: string): string => `gui/${uid}/${label}`;

  const kickstart = (label: string): void => {
    const r = io.run('launchctl', ['kickstart', '-k', target(label)]);
    if (r.error) throw new Error(`launchctl failed to start: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`launchctl kickstart -k ${target(label)} exited ${String(r.status ?? r.signal)}`);
  };

  const undoPrepare = (): void => {
    // Bootout first, in case cutover ever actually loaded it (PR #265 review, round 2) — "not found" is
    // an expected, harmless outcome here and its result is not checked.
    io.run('launchctl', ['bootout', target(LAUNCHD_LABEL)]);
    try { if (existsSync(newPath)) unlinkSync(newPath); } catch { /* best-effort */ }
  };

  return {
    how: `migrate ${legacyAgent.label} to ${LAUNCHD_LABEL}, then restart`,
    run: async () => {
      if (attempted) {
        // A later call is the HEALTH_DEADLINE_MS deadline's rollback restart — see migrateSystemdUnit
        // for why this reverts rather than just restarting the new label again.
        if (cutoverSucceeded) {
          // Never bootstrap legacy back up unless the new label is confirmed booted out first — the
          // same rule as the cutover below, so this can never leave both live either.
          const bootoutNew = io.run('launchctl', ['bootout', target(LAUNCHD_LABEL)]);
          const bootstrapLegacy = bootoutNew.status === 0 ? io.run('launchctl', ['bootstrap', `gui/${uid}`, legacyAgent.path]) : null;
          if (!bootstrapLegacy || bootstrapLegacy.status !== 0) {
            throw new Error(`could not revert the agent migration after the release failed to verify (${legacyAgent.label} did not come back up)`);
          }
          activeLabel = legacyAgent.label;
          cutoverSucceeded = false;
          outcome = 'fallback';
          undoPrepare();
          return;
        }
        return kickstart(activeLabel);
      }
      attempted = true;

      try {
        writeFileSync(newPath, withCurrentLabel(readFileSync(legacyAgent.path, 'utf8')));
      } catch (e) {
        outcome = 'prepare_failed';
        undoPrepare();
        try {
          kickstart(legacyAgent.label);
        } catch (restartErr) {
          throw new Error(`agent migration prepare failed (${(e as Error).message}), and the fallback restart also failed: ${(restartErr as Error).message}`);
        }
        return;
      }

      // Never attempt to bootstrap the new label unless the legacy one is confirmed booted out first
      // (PR #265 review, round 2) — otherwise a legacy bootout that fails while the new bootstrap
      // happens to succeed leaves both running.
      const bootout = io.run('launchctl', ['bootout', target(legacyAgent.label)]);
      const bootstrap = bootout.status === 0 ? io.run('launchctl', ['bootstrap', `gui/${uid}`, newPath]) : null;
      if (bootstrap && bootstrap.status === 0) {
        activeLabel = LAUNCHD_LABEL;
        cutoverSucceeded = true;
        outcome = 'migrated';
        return;
      }
      outcome = 'fallback';
      const fallback = io.run('launchctl', ['bootstrap', `gui/${uid}`, legacyAgent.path]);
      undoPrepare();
      if (fallback.status !== 0) {
        throw new Error(`migration cutover to ${LAUNCHD_LABEL} failed, and bringing ${legacyAgent.label} back up also failed`);
      }
    },
    confirmsReplacement: async (pid) => {
      const p = launchdPid(activeLabel, uid, io.run);
      return p === null ? null : pid === p;
    },
    migrationOutcome: () => outcome,
    finalizeMigration: async () => {
      if (!cutoverSucceeded) return;
      try { renameSync(legacyAgent.path, `${legacyAgent.path}.migrated`); } catch { /* best-effort */ }
    },
  };
}

export function restartCommand(config: string, io: HostIo = realHostIo): RestartOutcome {
  const unit = resolveInstalledUnit();
  const launchdAgent = resolveInstalledLaunchdAgent();

  if (process.platform === 'linux' && unit?.legacy) return migrateSystemdUnit(unit, io);
  if (process.platform === 'darwin' && launchdAgent?.legacy) return migrateLaunchdAgent(launchdAgent, io);

  const plan = planRestart({
    platform: process.platform,
    unit, launchdAgent,
    // Only `plan.restart` is read here; how the runner itself was launched was decided by the daemon.
    systemdRunAvailable: true,
    uid: process.getuid?.(),
  });

  if (!plan.restart) {
    // VS-316: the runner controls this daemon's whole lifecycle directly, so it — not an external
    // system — is the authority on which pid replaced the old one; no probing needed to confirm it.
    let startedPid: number | null = null;
    return {
      how: plan.how,
      run: async () => {
        await stopDaemon();
        // Never start a second daemon alongside a live one: confirm nothing still answers before
        // starting the replacement, even though `stopDaemon` above already verified its own kill.
        const base = healthUrl(config);
        if (base) {
          const still = await probeHealth(base);
          if (still?.ok) throw new Error(`a daemon is still answering at ${base}; refusing to start a second one`);
        }
        startedPid = startDaemon({}).pid;
      },
      confirmsReplacement: async (pid) => (startedPid === null ? null : pid === startedPid),
      ...notMigrating,
    };
  }

  const { cmd, args } = plan.restart;
  return {
    how: plan.how,
    run: async () => {
      const r = io.run(cmd, args);
      if (r.error) throw new Error(`${cmd} failed to start: ${r.error.message}`);
      if (r.status !== 0) {
        const detail = (r.stderr || r.stdout).trim().slice(0, 2000);
        throw new Error(`${[cmd, ...args].join(' ')} exited ${String(r.status ?? r.signal)}${detail ? `: ${detail}` : ''}`);
      }
    },
    confirmsReplacement: async (pid) => {
      if (unit) return confirmsReplacementViaSystemd(unit.name, pid, io);
      if (launchdAgent && process.platform === 'darwin') {
        const p = launchdPid(launchdAgent.label, process.getuid?.() ?? 0, io.run);
        return p === null ? null : pid === p;
      }
      return null;
    },
    ...notMigrating,
  };
}

/** `weave daemon upgrade-runner <upgradeId>`: hidden, started by the daemon, never by a human. */
export async function runUpgradeRunner(upgradeId: string): Promise<RunnerVerdict> {
  const config = configHome();
  const db = openDb(join(config, 'daemon.sqlite'));
  try {
    const row = db.get<Upgrade>('SELECT * FROM upgrades WHERE id = ?', [upgradeId]);
    if (!row || row.state !== 'restarting' || !row.toRelease) {
      return { outcome: 'gone', message: `upgrade ${upgradeId} is not waiting for a restart` };
    }
    const restart = restartCommand(config);
    let verdict: RunnerVerdict;
    try {
      verdict = await driveRestart({ release: row.toRelease, sha: row.toSha }, {
        restart: restart.run,
        probe: async () => {
          const base = healthUrl(config);
          return base ? probeHealth(base) : null;
        },
        rollbackTo: (release) => { switchRelease(release); },
        previousRelease: () => readLink(previousLink()),
        now: () => Date.now(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        alreadyCompleted: async () => db.get<{ state: string }>('SELECT state FROM upgrades WHERE id = ?', [upgradeId])?.state === 'completed',
        confirmsReplacement: restart.confirmsReplacement,
      });
    } catch (e) {
      // VS-316: the restart command itself failed to even request a restart (defect 2 of the incident:
      // this used to be silently discarded). No verdict was ever computed, so record it directly.
      const message = (e as Error).message;
      recordRestartCommandFailure(db, upgradeId, message, restart.migrationOutcome());
      return { outcome: 'gone', message };
    }
    if (verdict.outcome === 'completed') await restart.finalizeMigration();
    recordVerdict(db, upgradeId, verdict, restart.migrationOutcome());
    return verdict;
  } finally {
    db.close();
  }
}
