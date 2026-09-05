/**
 * The deferred daemon upgrade (PLAN §20): `conductor daemon update apply` and the web app's Upgrade
 * action record an intent here instead of performing one.
 *
 * The split that makes the failure story simple is the `current` symlink. Everything before it —
 * holding dispatch, waiting for every running turn to finish, cloning, installing, building, backing
 * the databases up — happens inside this daemon and is undone by doing nothing: the previous release
 * is still the one running. Everything after it belongs to a detached runner, because a process cannot
 * restart itself from inside a request.
 *
 * The record outlives the restart, which is the only way the outcome can be reported afterwards.
 */
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { newId, nowIso, type Db } from '@agent-conductor/db';
import {
  OcError, isCancellableUpgrade, isTerminalUpgrade,
  type DaemonConfig, type Upgrade, type UpgradeFailureReason, type UpgradeState,
} from '@agent-conductor/shared';
import { getLogger, recordActivity } from '@agent-conductor/core';
import {
  buildRelease, cliBinIn, currentLink, inOwnScope, planRestart, pruneReleases, readLink,
  releaseSha, switchRelease,
} from '@agent-conductor/release';
import type { WorkspaceRuntime } from './types.js';
import type { UpdateChecker } from './release-info.js';

const log = getLogger('daemon', { component: 'upgrade' });

/** The build's output is kept as a tail so the record stays small and a failure is still diagnosable. */
export const UPGRADE_LOG_LINES = 200;

/** How long a `restarting` record may sit before a booting daemon calls the restart unverified. */
export const RESTART_VERIFY_MS = 10 * 60 * 1000;

/** How often the idle gate re-reads the in-process run count. */
const IDLE_POLL_MS = 200;

export interface WaitingRun { workspace: string; running: number; runIds: string[] }

export interface UpgradeStatus {
  upgrade: Upgrade | null;
  /** Only while the upgrade is holding dispatch: the work it is waiting for. */
  waitingFor: WaitingRun[];
}

export interface UpgradeService {
  status(): UpgradeStatus;
  request(input: { requestedBy: string; ref?: string; source?: string; test?: boolean }): Upgrade;
  cancel(): Upgrade;
  /** Startup: settle whatever a previous daemon process left behind. */
  reconcile(): void;
  /** Tests only: await the background pipeline started by `request`. */
  settled(): Promise<void>;
}

export interface UpgradeDeps {
  db: Db;
  daemon: DaemonConfig;
  configDir: string;
  workspaces: Map<string, WorkspaceRuntime>;
  updates: UpdateChecker;
  version: string;
  /** The release this process is running from. */
  releaseRoot: string;
  // ---- seams, all defaulted; tests replace them ----
  build?: (o: { from: string; ref: string; test: boolean; onOutput: (line: string) => void }) => { path: string; sha: string } | Promise<{ path: string; sha: string }>;
  backup?: () => string[];
  switchTo?: (path: string) => { previous: string | null };
  prune?: (keep: number) => string[];
  spawnRunner?: (o: { upgradeId: string; release: string }) => void;
  now?: () => number;
}

const uniqueWorkspaces = (workspaces: Map<string, WorkspaceRuntime>): WorkspaceRuntime[] => [...new Set(workspaces.values())];

export function createUpgradeService(deps: UpgradeDeps): UpgradeService {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());
  const build = deps.build ?? ((o) => buildRelease({ from: o.from, ref: o.ref, test: o.test, log: o.onOutput, onOutput: o.onOutput }));
  const backup = deps.backup ?? (() => backupDatabases(deps.configDir));
  const switchTo = deps.switchTo ?? ((path: string) => switchRelease(path));
  const prune = deps.prune ?? ((keep: number) => pruneReleases(keep));
  const spawnRunner = deps.spawnRunner ?? ((o) => launchRunner(o.release, o.upgradeId, deps.configDir));

  let pipeline: Promise<void> = Promise.resolve();

  const read = (id: string): Upgrade | null => db.get<Upgrade>('SELECT * FROM upgrades WHERE id = ?', [id]) ?? null;
  const latest = (): Upgrade | null => db.get<Upgrade>('SELECT * FROM upgrades ORDER BY requested_at DESC, id DESC LIMIT 1') ?? null;
  const inFlight = (): Upgrade | null => {
    const row = latest();
    return row && !isTerminalUpgrade(row.state) ? row : null;
  };

  function set(id: string, patch: Record<string, unknown>): void {
    db.update('upgrades', id, patch);
  }

  function appendLog(id: string, line: string): void {
    const row = read(id);
    if (!row) return;
    const next = [...row.log, line].slice(-UPGRADE_LOG_LINES);
    set(id, { logJson: next });
  }

  function finish(id: string, state: Extract<UpgradeState, 'completed' | 'failed' | 'cancelled'>, extra: Record<string, unknown> = {}): void {
    set(id, { state, finishedAt: nowIso(), ...extra });
  }

  function fail(id: string, reason: UpgradeFailureReason, message: string): void {
    log.error({ upgradeId: id, reason, message }, 'upgrade failed');
    finish(id, 'failed', { reason, message: message.slice(0, 2000) });
  }

  /** Stop starting new runs everywhere. The stops take effect synchronously; the promises resolve at idle. */
  function holdDispatch(): Promise<unknown> {
    const stops = uniqueWorkspaces(deps.workspaces).map((w) => w.services.dispatcher.stop().catch(() => undefined));
    return Promise.all(stops);
  }

  /** The `undrain` rule: resume everywhere except a workspace that was paused in its own right. */
  function resumeDispatch(): string[] {
    const resumed: string[] = [];
    for (const w of uniqueWorkspaces(deps.workspaces)) {
      let status = 'active';
      try { status = w.ctx.db.get<{ status: string }>('SELECT status FROM workspaces WHERE id = ?', [w.ctx.workspaceId])?.status ?? 'active'; } catch { /* keep active */ }
      if (status === 'paused') continue;
      try { w.services.dispatcher.start(); resumed.push(w.id); } catch (e) { log.warn({ err: e, ws: w.id }, 'dispatcher failed to resume'); }
    }
    return resumed;
  }

  /**
   * What the upgrade is waiting for. The count is the in-process truth — the same number the idle gate
   * reads — and the run ids are only offered for a workspace that actually has one executing, so a row
   * left behind by a dead daemon never shows up as work.
   */
  function waitingFor(): WaitingRun[] {
    const out: WaitingRun[] = [];
    for (const w of uniqueWorkspaces(deps.workspaces)) {
      let running = 0;
      try { running = w.services.dispatcher.running(); } catch { running = 0; }
      if (running === 0) continue;
      let runIds: string[] = [];
      try { runIds = w.services.runs.list({ status: ['running'] }).items.map((r) => r.id); } catch { runIds = []; }
      out.push({ workspace: w.id, running, runIds });
    }
    return out;
  }

  const idle = (): boolean => waitingFor().length === 0;

  function cancelledMidway(id: string): boolean {
    const row = read(id);
    return !row || isTerminalUpgrade(row.state);
  }

  /**
   * Wait until nothing is executing. Polled rather than awaited on the stop promises, because a
   * cancellation has to be noticed while those are still pending.
   */
  async function waitForIdle(id: string): Promise<'idle' | 'timeout' | 'cancelled'> {
    const deadline = now() + deps.daemon.upgrade.waitForIdleSec * 1000;
    for (;;) {
      if (cancelledMidway(id)) return 'cancelled';
      if (idle()) return 'idle';
      if (now() >= deadline) return 'timeout';
      await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
    }
  }

  async function advance(id: string): Promise<void> {
    const row = read(id);
    if (!row) return;
    void holdDispatch();
    set(id, { state: 'waiting', startedAt: nowIso() });

    const outcome = await waitForIdle(id);
    if (outcome === 'cancelled') return;
    if (outcome === 'timeout') {
      fail(id, 'wait_timeout', `still ${waitingFor().reduce((n, w) => n + w.running, 0)} run(s) executing after ${deps.daemon.upgrade.waitForIdleSec}s; nothing was built or switched`);
      resumeDispatch();
      return;
    }
    if (cancelledMidway(id)) return;

    // ---- build: a fresh directory, nothing installed is touched ----
    set(id, { state: 'building' });
    let built: { path: string; sha: string };
    try {
      built = await build({ from: row.source, ref: row.ref, test: Boolean(row.runTest), onOutput: (line) => appendLog(id, line) });
    } catch (e) {
      fail(id, 'build_failed', (e as Error).message);
      resumeDispatch();
      return;
    }
    if (cancelledMidway(id)) return;

    // ---- switch: back up first, then swing `current` ----
    set(id, { state: 'switching' });
    let backups: string[];
    try {
      backups = backup();
      set(id, { backupsJson: backups });
    } catch (e) {
      fail(id, 'backup_failed', (e as Error).message);
      resumeDispatch();
      return;
    }
    const wasCurrent = readLink(currentLink());
    try {
      switchTo(built.path);
      prune(deps.daemon.upgrade.keep);
    } catch (e) {
      fail(id, 'switch_failed', (e as Error).message);
      resumeDispatch();
      return;
    }

    // ---- restart: not ours to do ----
    set(id, { state: 'restarting', toRelease: built.path, toSha: releaseSha(built.path) ?? built.sha });
    try {
      spawnRunner({ upgradeId: id, release: built.path });
    } catch (e) {
      // The runner never started, so nothing will restart or roll back: undo the swing ourselves.
      if (wasCurrent) { try { switchTo(wasCurrent); } catch { /* leave it to the human */ } }
      fail(id, 'restart_failed', `the restart runner could not be started: ${(e as Error).message}`);
      resumeDispatch();
    }
  }

  /**
   * An upgrade is recorded daemon-level, in `daemon.sqlite`, which has no workspace — but the changelog
   * (PLAN §13.6) is per workspace, so the completed upgrade is pushed outward: one `daemon.upgraded`
   * activity row in each registered workspace, belonging to no project and no ticket.
   *
   * Guarded by the upgrade id, so reconciling the same upgrade twice writes nothing. This is the only
   * changelog entry the daemon has to write; every other kind was already in `activity` and needed no
   * backfill. It cannot be applied retroactively — upgrades that completed before this shipped have no
   * row — so upgrades appear in the changelog from the first one after this release.
   */
  function recordUpgradeInChangelogs(row: Upgrade): void {
    for (const w of uniqueWorkspaces(deps.workspaces)) {
      try {
        const already = w.ctx.db.get<{ id: string }>(
          "SELECT id FROM activity WHERE workspace_id = ? AND action = 'daemon.upgraded' AND entity_id = ?",
          [w.ctx.workspaceId, row.id]);
        if (already) continue;
        recordActivity(
          w.ctx.db, w.ctx.workspaceId,
          { kind: 'system', id: null }, 'daemon.upgraded', 'daemon', row.id,
          { fromRelease: row.fromRelease, toRelease: row.toRelease, version: deps.version, requestedBy: row.requestedBy },
        );
      } catch (e) {
        // A workspace whose db is unavailable must not stop the upgrade from being reported completed.
        log.warn({ err: e, upgradeId: row.id, workspaceId: w.id }, 'could not record the upgrade in a workspace changelog');
      }
    }
  }

  return {
    status(): UpgradeStatus {
      const upgrade = latest();
      return { upgrade, waitingFor: upgrade && isCancellableUpgrade(upgrade.state) ? waitingFor() : [] };
    },

    request(input): Upgrade {
      const existing = inFlight();
      if (existing) throw new OcError('conflict', `upgrade ${existing.id} is already ${existing.state}`, { upgradeId: existing.id, state: existing.state });
      const source = input.source ?? deps.daemon.upgrade.source;
      if (!source) throw new OcError('validation', 'no release source: set upgrade.source in daemon.yaml or pass one');
      const ref = input.ref ?? deps.daemon.upgrade.ref;
      // Best effort: the record says what it aimed at even if the source cannot be reached right now.
      let targetSha: string | null = null;
      try { targetSha = deps.updates.check().targetSha; } catch { targetSha = null; }

      const id = newId();
      db.insert('upgrades', {
        id, state: 'queued', source, ref, targetSha, runTest: Boolean(input.test),
        fromRelease: deps.releaseRoot, requestedBy: input.requestedBy, requestedAt: nowIso(),
        logJson: [], backupsJson: [],
      });
      log.info({ upgradeId: id, source, ref, targetSha }, 'upgrade requested');
      pipeline = pipeline.then(() => advance(id)).catch((e: unknown) => {
        log.error({ err: e, upgradeId: id }, 'upgrade pipeline crashed');
        if (!cancelledMidway(id)) { fail(id, 'build_failed', String(e)); resumeDispatch(); }
      });
      return read(id)!;
    },

    cancel(): Upgrade {
      const row = inFlight();
      if (!row) throw new OcError('not_found', 'no upgrade is in flight');
      if (!isCancellableUpgrade(row.state)) {
        throw new OcError('conflict', `upgrade ${row.id} is ${row.state} and can no longer be cancelled`, { upgradeId: row.id, state: row.state });
      }
      finish(row.id, 'cancelled', { message: 'cancelled before the build started' });
      resumeDispatch();
      log.info({ upgradeId: row.id }, 'upgrade cancelled');
      return read(row.id)!;
    },


    reconcile(): void {
      const row = inFlight();
      if (!row) return;
      if (row.state === 'restarting') {
        const runningSha = releaseSha(deps.releaseRoot);
        const onTarget = (row.toRelease && row.toRelease === deps.releaseRoot)
          || Boolean(row.toSha && runningSha && row.toSha === runningSha);
        if (onTarget) {
          finish(row.id, 'completed', { cameBackVersion: deps.version });
          recordUpgradeInChangelogs(row);
          log.info({ upgradeId: row.id, version: deps.version }, 'upgrade completed');
          return;
        }
        const startedMs = Date.parse(row.startedAt ?? row.requestedAt);
        if (Number.isFinite(startedMs) && now() - startedMs < RESTART_VERIFY_MS) return; // the runner may still be working
        fail(row.id, 'restart_unverified', `the daemon came back on ${deps.releaseRoot}, not on ${row.toRelease ?? 'the target release'}`);
        return;
      }
      // Anything before `restarting` belonged to a process that is gone. Dispatch already restarted with
      // this daemon; what a stale record would block is every future upgrade, through the conflict check.
      fail(row.id, 'abandoned', `the daemon restarted while the upgrade was ${row.state}`);
    },

    settled(): Promise<void> {
      return pipeline;
    },
  };
}

// ---------- the pieces the daemon does itself ----------

/**
 * Copy daemon.sqlite and every registered workspace db into `<config>/backups/<stamp>/`. Same shape as
 * `conductor daemon upgrade`'s: sqlite's online backup, safe while the daemon is serving.
 */
export function backupDatabases(configDir: string): string[] {
  const dir = join(configDir, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
  const out: string[] = [];
  const sources: Array<{ src: string; name: string }> = [{ src: join(configDir, 'daemon.sqlite'), name: 'daemon.sqlite' }];
  try {
    const reg = (parseYaml(readFileSync(join(configDir, 'workspaces.yaml'), 'utf8')) ?? {}) as { workspaces?: Array<{ id: string; path: string }> };
    for (const w of reg.workspaces ?? []) sources.push({ src: join(w.path, '.agent-conductor', 'db.sqlite'), name: `workspace-${w.id}.sqlite` });
  } catch { /* no registry */ }
  for (const { src, name } of sources) {
    if (!existsSync(src)) continue;
    mkdirSync(dir, { recursive: true });
    copyFileSync(src, join(dir, name));
    out.push(join(dir, name));
  }
  return out;
}

function onPath(bin: string): boolean {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function serviceUnitPath(): string {
  return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'systemd', 'user', 'agent-conductor.service');
}

function launchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', 'com.agentconductor.daemon.plist');
}

/**
 * Start the restart runner: the **new** release's CLI, so a release that changed the runner ships its
 * own. Detached and in its own session; under systemd it also needs its own transient scope, because
 * restarting a user service kills that service's whole control group.
 */
export function launchRunner(release: string, upgradeId: string, configDir: string): void {
  const plan = planRestart({
    platform: process.platform,
    unitInstalled: existsSync(serviceUnitPath()),
    launchdInstalled: existsSync(launchdPlistPath()),
    systemdRunAvailable: onPath('systemd-run'),
    uid: process.getuid?.(),
  });
  const base = { cmd: process.execPath, args: [cliBinIn(release), 'daemon', 'upgrade-runner', upgradeId] };
  const launched = plan.launch === 'systemd-run' ? inOwnScope(`ac-upgrade-${upgradeId}`, base.cmd, base.args) : base;
  log.info({ upgradeId, release, how: plan.how, launch: plan.launch, runnerSurvives: plan.runnerSurvives }, 'starting the restart runner');
  const child = spawn(launched.cmd, launched.args, {
    detached: true, stdio: 'ignore',
    env: { ...process.env, AC_CONFIG_HOME: configDir, AC_UPGRADE_RELEASE: release },
  });
  child.unref();
}
