/**
 * The deferred daemon upgrade (PLAN §20): `weave daemon update apply` and the web app's Upgrade
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
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { newId, nowIso, type Db } from '@weave-ai/db';
import {
  CHANGELOG_SOURCES, OcError, isCancellableUpgrade, isTerminalUpgrade,
  type DaemonConfig, type Upgrade, type UpgradeFailureReason, type UpgradeHealthCheck, type UpgradeState,
} from '@weave-ai/shared';
import { getLogger, recordActivity } from '@weave-ai/core';
import {
  buildRelease, cliBinIn, commitSubjectsInRange, currentLink, inOwnScope, migrationsIn, planRestart,
  pruneReleases, readLink, releaseSha, resolveInstalledLaunchdAgent, resolveInstalledUnit,
  resolveWorkspaceStateDir, switchRelease,
} from '@weave-ai/release';
import type { WorkspaceRuntime } from './types.js';
import type { UpdateChecker } from './release-info.js';
import {
  announcementReason, announcementText, buildAnnouncement,
  type AnnouncementFacts, type LandedTicket,
} from './upgrade-announce.js';

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
  /**
   * Report every terminal upgrade that has not been reported yet (VS-76): one line on each workspace's
   * primary chat thread and one `system` wake for its conductor. Called by the daemon once it is
   * serving again, and by the pipeline when an upgrade fails before anything restarts.
   */
  announce(): Promise<void>;
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
  /** The runtime adapters registered on this daemon; one of the announcement's health checks. */
  runtimes?: () => string[];
  // ---- seams, all defaulted; tests replace them ----
  build?: (o: { from: string; ref: string; test: boolean; onOutput: (line: string) => void }) => { path: string; sha: string } | Promise<{ path: string; sha: string }>;
  backup?: () => string[];
  switchTo?: (path: string) => { previous: string | null };
  prune?: (keep: number) => string[];
  spawnRunner?: (o: { upgradeId: string; release: string }) => void;
  now?: () => number;
  /**
   * VS-316, Decision 6: arms the still-serving-process watchdog right after `spawnRunner` succeeds.
   * Defaults to a real, `unref`'d `setTimeout` for `RESTART_VERIFY_MS`; tests replace it to invoke
   * `check` synchronously instead of waiting 10 real minutes.
   */
  armRestartWatchdog?: (o: { upgradeId: string; check: () => void }) => void;
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
  const armRestartWatchdog = deps.armRestartWatchdog ?? ((o) => { const t = setTimeout(o.check, RESTART_VERIFY_MS); t.unref?.(); });

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

  /**
   * VS-316, Decision 6. `advance()`'s success path holds dispatch on the assumption that the restart
   * will replace this process, so a new one dispatches on its own boot — an assumption this exact
   * ticket's defects broke, leaving dispatch held here forever while the restart silently never
   * happened (1h40m of it, across three workspaces, in the incident this fixes). If this process is
   * still executing this callback once `RESTART_VERIFY_MS` has passed, it was never replaced: fail the
   * upgrade and resume dispatch itself, rather than wait on a replacement that is not coming.
   *
   * Guarded exactly like `recordVerdict` (`packages/cli/src/upgrade-runner.ts`) so a verdict that
   * lands from the runner (or a rollback) at nearly the same instant and this watchdog can never both
   * apply — only the guarded write's own success decides whether to resume dispatch here.
   */
  function armStillServingWatchdog(id: string): void {
    armRestartWatchdog({
      upgradeId: id,
      check: () => {
        const message = `this process is still serving ${deps.releaseRoot} ${Math.round(RESTART_VERIFY_MS / 1000)}s after the restart was requested; it was apparently never replaced`;
        const result = db.run(
          "UPDATE upgrades SET state = 'failed', finished_at = ?, reason = 'restart_unverified', message = ? WHERE id = ? AND state = 'restarting'",
          [nowIso(), message, id],
        );
        if (result.changes === 1) {
          log.warn({ upgradeId: id }, 'restart never replaced this process; resuming dispatch here');
          resumeDispatch();
        }
      },
    });
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
    // Counted before the hold takes hold: once the runs have drained nothing can say how many there were.
    const drainedRuns = waitingFor().reduce((n, w) => n + w.running, 0);
    void holdDispatch();
    set(id, { state: 'waiting', startedAt: nowIso(), drainedRuns });
    // Told as soon as dispatch is held, not after the wait resolves — the chat explains the silence
    // instead of leaving it unexplained (VS-115). Best-effort: a notification failure never blocks the
    // upgrade itself.
    void announceStarting(row).catch((e: unknown) => log.warn({ err: e, upgradeId: id }, 'could not tell a workspace the upgrade is starting'));

    const outcome = await waitForIdle(id);
    if (outcome === 'cancelled') return;
    if (outcome === 'timeout') {
      // No longer a failure (VS-115): whatever is still executing is ended and resumed by the restart
      // that follows, exactly like any run a daemon restart interrupts — the same guarantee the local
      // CLI drain already relies on. The upgrade proceeds to building below, same as the idle outcome.
      const interruptedRuns = waitingFor().reduce((n, w) => n + w.running, 0);
      appendLog(id, `still ${interruptedRuns} run(s) executing after ${deps.daemon.upgrade.waitForIdleSec}s; proceeding anyway — they will be interrupted by the restart and resume on their own`);
      set(id, { interruptedRuns });
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
      // VS-316: dispatch stays held here on the assumption that this process is about to be replaced.
      // If it never is, this is the backstop that notices and resumes it — see armStillServingWatchdog.
      armStillServingWatchdog(id);
    } catch (e) {
      // The runner never started, so nothing will restart or roll back: undo the swing ourselves.
      if (wasCurrent) { try { switchTo(wasCurrent); } catch { /* leave it to the human */ } }
      fail(id, 'restart_failed', `the restart runner could not be started: ${(e as Error).message}`);
      resumeDispatch();
    }
  }

  // ---------- the starting notice (VS-115) ----------

  /**
   * Tell every workspace the upgrade has begun holding dispatch, before the wait for idle or anything
   * else, so a message sent to the conductor during the hold is explained rather than silently queued.
   * Best-effort per workspace: one that cannot be reached does not stop the upgrade or the others from
   * being told, the same resilience `announceTo` already has.
   */
  async function announceStarting(row: Upgrade): Promise<void> {
    const target = row.targetSha ? ` (${row.targetSha.slice(0, 7)})` : '';
    const text = `Upgrading to ${row.ref}${target} — I'll be back to answer once it's serving again.`;
    for (const w of uniqueWorkspaces(deps.workspaces)) {
      try { await w.services.threads.notifyHuman({ kind: 'system', id: null }, { text }); }
      catch (e) { log.warn({ err: e, upgradeId: row.id, workspaceId: w.id }, 'could not tell a workspace the upgrade is starting'); }
    }
  }

  // ---------- the announcement (VS-76) ----------

  /** The three checks behind "back up": the workspace answers, the supervisor ticks, runtimes are registered. */
  function healthChecks(w: WorkspaceRuntime): UpgradeHealthCheck[] {
    const checks: UpgradeHealthCheck[] = [];
    try { w.ctx.db.get('SELECT 1 AS one'); checks.push({ name: 'database', ok: true, detail: 'answers' }); }
    catch (e) { checks.push({ name: 'database', ok: false, detail: (e as Error).message }); }
    let ticking = false;
    try { ticking = w.services.supervisor.running(); } catch { ticking = false; }
    checks.push({ name: 'supervisor', ok: ticking, detail: ticking ? 'ticking' : 'not ticking' });
    const runtimes = deps.runtimes?.() ?? [];
    checks.push({ name: 'runtimes', ok: runtimes.length > 0, detail: runtimes.length ? runtimes.join(', ') : 'none registered' });
    return checks;
  }

  /**
   * The work the new release contains, read from the same rows the changelog projects as `landed` —
   * `mergeDone` writes one when the work actually reached the clone, so this is the delivery record and
   * not a second opinion about it.
   */
  function landedTickets(w: WorkspaceRuntime, window: { since: string | null; until: string }): LandedTicket[] {
    if (!window.since) return [];
    return w.ctx.db.all<LandedTicket>(
      `SELECT t.identifier AS identifier, t.title AS title, a.created_at AS at
         FROM activity a JOIN tickets t ON t.id = a.ticket_id
        WHERE a.workspace_id = ? AND a.action = ? AND a.created_at > ? AND a.created_at <= ?
        ORDER BY a.created_at DESC`,
      [w.ctx.workspaceId, CHANGELOG_SOURCES.landed.action, window.since, window.until],
    );
  }

  /** The workspace's own ticket prefix, e.g. `VS` — read once per announcement rather than assumed. */
  function workspaceTicketPrefix(w: WorkspaceRuntime): string | null {
    return w.ctx.db.get<{ ticketPrefix: string }>(
      'SELECT ticket_prefix AS ticketPrefix FROM workspaces WHERE id = ?', [w.ctx.workspaceId])?.ticketPrefix ?? null;
  }

  /**
   * Ticket identifiers a commit subject names at its start (`<PREFIX>-<n>: ...`, this monorepo's own
   * convention), deduplicated, in the order first seen — used only to size and name a gap against the
   * delivery records, never to build the list of landed tickets itself (VS-239).
   */
  function ticketRefsInSubjects(subjects: string[], prefix: string): string[] {
    const re = new RegExp(`^${prefix}-(\\d+):`);
    const seen = new Set<string>();
    for (const subject of subjects) {
      const m = re.exec(subject);
      if (m) seen.add(`${prefix}-${m[1]}`);
    }
    return [...seen];
  }

  /**
   * The migrations a database records as applied, read from its durable `meta` rows — never the
   * in-memory `appliedMigrations`, which is empty when an earlier boot ran `migrate` (VS-315).
   */
  function durableMigrations(database: Db): string[] {
    return database.all<{ value: string }>("SELECT value FROM meta WHERE key LIKE 'migration:%'").map((r) => r.value);
  }

  function facts(w: WorkspaceRuntime, row: Upgrade): AnnouncementFacts {
    const migrationsApplied = [...new Set([...durableMigrations(db), ...durableMigrations(w.ctx.db)])];
    const prefix = workspaceTicketPrefix(w);
    return {
      running: { path: deps.releaseRoot, sha: releaseSha(deps.releaseRoot), version: deps.version },
      shaOf: (release) => (release ? releaseSha(release) : null),
      landed: (window) => landedTickets(w, window),
      // Read from `row.toRelease` — the specific upgrade being announced — never `deps.releaseRoot`,
      // which is whatever this daemon happens to be running by the time it gets around to announcing.
      commitTicketRefs: (from, to) => {
        if (!prefix || !row.toRelease) return [];
        return ticketRefsInSubjects(commitSubjectsInRange(row.toRelease, from, to), prefix);
      },
      // VS-339: the turns the restart cut off, read from the records finalize left, and how many of
      // their own wakes are queued to resume. Both are facts of the workspace database, not a
      // pre-restart snapshot — so they agree with what actually happened.
      interrupted: (window) => {
        const runs = w.ctx.db.all<{ id: string; wakeupIds: string[] | null }>(
          `SELECT id, wakeup_ids_json FROM runs
            WHERE workspace_id = ? AND error_code = 'interrupted_by_shutdown'
              AND finished_at IS NOT NULL AND finished_at > ? AND finished_at <= ?`,
          [w.ctx.workspaceId, window.since ?? '', window.until],
        );
        let resumed = 0;
        for (const run of runs) {
          for (const id of run.wakeupIds ?? []) {
            const status = w.ctx.db.get<{ status: string }>('SELECT status FROM wakeups WHERE id = ?', [id])?.status;
            if (status === 'queued') resumed += 1;
          }
        }
        return { interrupted: runs.length, resumed };
      },
      migrationsIn: (release) => migrationsIn(release),
      migrationsApplied,
      checks: healthChecks(w),
      now: nowIso(),
    };
  }

  /**
   * Tell one workspace. The line goes out over the channel path first, because it reaches the human
   * whatever state the conductor is in; the wake carries the detail the line leaves out.
   */
  async function announceTo(w: WorkspaceRuntime, row: Upgrade): Promise<void> {
    const announcement = buildAnnouncement(row, facts(w, row));
    await w.services.threads.notifyHuman({ kind: 'system', id: null }, { text: announcementText(announcement) });
    const conductor = await w.services.workers.ensureConductor();
    w.services.wake.enqueue(conductor.id, {
      source: 'system',
      reason: announcementReason(announcement),
      payload: { ...announcement },
      idempotencyKey: `daemon.upgraded:${row.id}`,
      requestedBy: { kind: 'system', id: null },
    });
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

  const service: UpgradeService = {
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
      // A failure before the restart is announced here: no daemon is going to boot and report it.
      }).then(() => service.announce()).catch((e: unknown) => log.warn({ err: e, upgradeId: id }, 'upgrade announcement failed'));
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

    async announce(): Promise<void> {
      const pending = db.all<Upgrade>(
        "SELECT * FROM upgrades WHERE announced_at IS NULL AND state IN ('completed', 'failed') ORDER BY requested_at, id");
      for (const row of pending) {
        // The claim is the guard: whoever sets `announced_at` announces, and a second caller — the next
        // boot, a concurrent pipeline — sees no rows to claim.
        const claimed = db.run('UPDATE upgrades SET announced_at = ? WHERE id = ? AND announced_at IS NULL', [nowIso(), row.id]);
        if (claimed.changes !== 1) continue;
        for (const w of uniqueWorkspaces(deps.workspaces)) {
          try { await announceTo(w, row); }
          catch (e) { log.warn({ err: e, upgradeId: row.id, workspaceId: w.id }, 'could not announce the upgrade to a workspace'); }
        }
        log.info({ upgradeId: row.id, state: row.state }, 'upgrade announced');
      }
    },

    settled(): Promise<void> {
      return pipeline;
    },
  };

  return service;
}

// ---------- the pieces the daemon does itself ----------

/**
 * Copy daemon.sqlite and every registered workspace db into `<config>/backups/<stamp>/`. Same shape as
 * `weave daemon upgrade`'s: sqlite's online backup, safe while the daemon is serving.
 */
export function backupDatabases(configDir: string): string[] {
  const dir = join(configDir, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
  const out: string[] = [];
  const sources: Array<{ src: string; name: string }> = [{ src: join(configDir, 'daemon.sqlite'), name: 'daemon.sqlite' }];
  let workspaces: Array<{ id: string; path: string }> = [];
  try {
    const reg = (parseYaml(readFileSync(join(configDir, 'workspaces.yaml'), 'utf8')) ?? {}) as { workspaces?: Array<{ id: string; path: string }> };
    workspaces = reg.workspaces ?? [];
  } catch { /* no registry */ }
  // VS-258: not folded into the try above — an ambiguous workspace install must fail this backup
  // loudly, not be swallowed by the registry's own "no registry file" catch.
  for (const w of workspaces) sources.push({ src: join(resolveWorkspaceStateDir(w.path).stateDir, 'db.sqlite'), name: `workspace-${w.id}.sqlite` });
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

/**
 * Start the restart runner: the **new** release's CLI, so a release that changed the runner ships its
 * own. Detached and in its own session; under systemd it also needs its own transient scope, because
 * restarting a user service kills that service's whole control group.
 */
export function launchRunner(release: string, upgradeId: string, configDir: string): void {
  const plan = planRestart({
    platform: process.platform,
    unit: resolveInstalledUnit(),
    launchdAgent: resolveInstalledLaunchdAgent(),
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
