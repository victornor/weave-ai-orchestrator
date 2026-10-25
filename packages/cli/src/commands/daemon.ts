/** `weave daemon start|stop|status|logs|set-password|install-service` (PLAN §20). */
import type { Command } from 'commander';
import { ApiError } from '../api.js';
import { emit, fields, style, table, write } from '../output.js';
import { promptHidden } from '../prompt.js';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { join } from 'node:path';
import { configHome } from '../contexts.js';
import { followLog, installLaunchdAgent, installService, isRunning, listenPort, logFile, pidFile, preflightRestart, readPid, realRun, reconcileDetachedDaemon, renderLaunchdPlist, renderServiceUnit, resolveServerBin, startDaemon, startDaemonService, stopDaemon, stopDaemonService, systemdMainPid, tailLog, verifyRestart, LAUNCHD_LABEL, type RestartTarget } from '../daemon.js';
import { buildRelease, currentLink, findPortHolder, listReleases, previousLink, pruneReleases, readLink, releaseSha, releaseStamp, resolveInstalledUnit, resolveWorkspaceStateDir, switchRelease, writeShimsFromRelease, writeUserShims, type ShimWriteResult } from '../release.js';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { AC_ENV, isTerminalUpgrade, type Upgrade } from '@weave-ai/shared';
import { run, session, warnDeprecatedConductor } from './util.js';
import { runUpgradeRunner } from '../upgrade-runner.js';

interface Health {
  ok?: boolean;
  version?: string;
  release?: { version?: string; path?: string; sha?: string | null };
  workspaces?: Array<{ id?: string; name?: string; status?: string }>;
  operatorConfigured?: boolean;
  tlsMode?: string;
  publicUrl?: string;
}

function displayVersion(version: string | null | undefined, path?: string | null): string {
  const ver = version ?? '?';
  const stamp = path ? releaseStamp(path) : null;
  return stamp ? `${ver} · ${stamp}` : ver;
}

/** VS-377: say where the `weave` shim landed, or why it could not be written. */
function reportShim(shim: ShimWriteResult | null): void {
  if (!shim) return;
  if (shim.present) write(`${style.dim('shim')} ${shim.path}`);
  else write(style.warn('no `weave` shim: no current release to point at — it is created on the next `weave daemon upgrade`'));
}
interface DaemonYaml { upgrade?: { source?: string; ref?: string; keep?: number; drainTimeoutSec?: number } }

interface DaemonMarker { pid?: number; publicUrl?: string; setupRequired?: boolean }

/** The daemon's own boot marker, or null when it has not written one yet. */
function readMarker(): string | null {
  try { return readFileSync(join(configHome(), 'daemon.json'), 'utf8'); } catch { return null; }
}

/**
 * Wait until the daemon writes its `daemon.json` (it is listening) or, when `pid` is given, that pid
 * dies (port in use, bad config …). `previous` makes the systemd path wait for a *fresh* marker: the
 * file survives a stop, so its mere presence is not proof a new daemon booted.
 */
async function waitForDaemonJson(expected: { pid?: number; previous?: string | null }): Promise<DaemonMarker | null> {
  const marker = join(configHome(), 'daemon.json');
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (expected.pid !== undefined && !isRunning(expected.pid)) {
      const log = logFile();
      let tail = '';
      try { tail = readFileSync(log, 'utf8').trim().split('\n').slice(-8).join('\n'); } catch { /* no log */ }
      throw new ApiError('internal', `the daemon exited right after starting (see ${log})`, 500, { logTail: tail });
    }
    let raw: string | null = null;
    try { raw = readFileSync(marker, 'utf8'); } catch { /* not yet */ }
    if (raw !== null && (expected.previous === undefined || raw !== expected.previous)) {
      try {
        const j = JSON.parse(raw) as DaemonMarker;
        if (expected.pid === undefined || j.pid === expected.pid) return j;
      } catch { /* not valid json yet */ }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

export function register(program: Command): void {
  const daemon = program.command('daemon').description('daemon lifecycle on this machine');

  daemon
    .command('start')
    .description('start the Weave AI daemon')
    .option('-f, --foreground', 'run in the foreground and stream logs here')
    .option('--listen <addr>', 'override the listen address, e.g. 127.0.0.1:7433')
    .action(async (opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const existing = readPid();
      // VS-407: a detached daemon with a unit installed is handed over, not answered "already running".
      if (isRunning(existing)) {
        const handover = await reconcileDetachedDaemon();
        if (!handover.reconciled) {
          emit({ started: false, pid: existing, reason: 'already running' }, () => write(`${style.dim('already running')} pid ${existing}`));
          return;
        }
        emit({ started: false, handedOver: handover.pid, unit: resolveInstalledUnit()?.name ?? null }, () => write(`${style.dim('handover:')} ${handover.reason}; starting the unit`));
      }
      // VS-376: with a unit installed the daemon is a service — start it through systemd, so it
      // survives this terminal and `systemctl` can see it. A foreground debug run never uses the unit.
      if (opts['foreground'] !== true) {
        const previousMarker = readMarker();
        const service = startDaemonService();
        if (service) {
          const ready = await waitForDaemonJson({ previous: previousMarker });
          emit({ started: true, unit: service.unit, how: service.how, publicUrl: ready?.publicUrl ?? null }, () => {
            write(`${style.ok(ready ? 'started' : 'started (not confirmed yet)')} ${service.how}`);
            if (ready?.setupRequired) write(style.warn('public listener held: no operator password yet — run `weave daemon set-password` on this machine to open it'));
            fields([['url', ready?.setupRequired ? `${ready.publicUrl ?? ''} (after set-password)` : ready?.publicUrl ?? '(pending)'], ['unit', service.unit], ['log', logFile()], ['next', ready?.setupRequired ? 'weave daemon set-password' : 'weave daemon status']]);
          });
          return;
        }
      }
      const result = startDaemon({
        foreground: opts['foreground'] === true,
        ...(typeof opts['listen'] === 'string' ? { listen: opts['listen'] } : {}),
      });
      let ready: DaemonMarker | null = null;
      if (!result.foreground && result.pid) ready = await waitForDaemonJson({ pid: result.pid });
      emit({ started: true, ...result, publicUrl: ready?.publicUrl ?? null }, () => {
        if (result.foreground) return;
        write(`${style.ok(ready ? 'started' : 'started (not confirmed yet)')} pid ${result.pid}`);
        if (ready?.setupRequired) write(style.warn('public listener held: no operator password yet — run `weave daemon set-password` on this machine to open it'));
        fields([['url', ready?.setupRequired ? `${ready.publicUrl ?? ''} (after set-password)` : ready?.publicUrl ?? '(pending)'], ['bin', result.bin], ['log', result.log], ['next', ready?.setupRequired ? 'weave daemon set-password' : 'weave daemon status']]);
      });
    }));

  daemon
    .command('stop')
    .description('stop the daemon started from this machine')
    .option('--drain-timeout <sec>', 'seconds to wait for running turns before stopping', '180')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      // VS-262: the same bounded, deliberate grace period `daemon restart`/`upgrade`/`rollback`
      // already give running turns before signalling the process — a plain stop used to skip this
      // entirely and go straight to `stopDaemon()`'s SIGTERM.
      const { interrupted } = await drainViaHttp(command, Number.parseInt(String(opts['drainTimeout'] ?? '180'), 10));
      // VS-407: `daemon.pid` may name a detached daemon systemd cannot touch; hand it over by PID
      // before asking the unit to stop, or the unit's stop never frees the port.
      const handover = await reconcileDetachedDaemon();
      if (handover.reconciled) write(style.dim(`handover: ${handover.reason}`));
      // VS-376: a bare SIGTERM to the pid would be restarted by `Restart=always`; when the daemon is
      // a unit, stop it through systemd so the stop is deliberate and sticks.
      const service = stopDaemonService();
      if (service) {
        emit({ stopped: true, unit: service.unit, interrupted }, () => {
          write(`${style.ok('stopped')} ${service.how}`);
          if (interrupted.length) write(style.warn(`${interrupted.length} run(s) were still going and got interrupted; they resume on their own`));
        });
        return;
      }
      const result = await stopDaemon();
      emit({ ...result, interrupted }, () => {
        write(result.stopped ? `${style.ok('stopped')} pid ${result.pid}` : 'not running');
        if (interrupted.length) write(style.warn(`${interrupted.length} run(s) were still going and got interrupted; they resume on their own`));
      });
    }));

  daemon
    .command('restart')
    .description('drain running turns (bounded), then restart the daemon on the current release')
    .option('--drain-timeout <sec>', 'seconds to wait for running turns', '900')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      if (process.env[AC_ENV.RUN_TOKEN]) throw new ApiError('forbidden', 'not available inside a worker run', 403);
      const result = await drainAndRestart(command, Number.parseInt(String(opts['drainTimeout'] ?? '900'), 10), targetOf(currentLink()));
      emit(result, () => write(`${style.ok('restarted')} ${result.how} · ${result.version ?? '?'}`));
    }));

  daemon
    .command('status')
    .description('local process state plus GET /api/health')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const pid = readPid();
      const local = { pid, running: isRunning(pid), pidFile: pidFile(), log: logFile() };
      // VS-376: a daemon started from a terminal is not the unit's — it dies with that terminal and
      // an upgrade expects the unit, so name it rather than reporting a bare "running".
      const unit = process.platform === 'linux' ? resolveInstalledUnit() : null;
      const unitPid = unit ? systemdMainPid(unit) : null;
      const outsideUnit = Boolean(unit && local.running && local.pid !== unitPid);
      let health: Health | null = null;
      let error: string | null = null;
      try {
        const { client } = await session(command, { workspace: 'none' });
        health = await client.get<Health>('/api/health');
      } catch (e) {
        error = e instanceof ApiError ? `${String(e.code).toUpperCase()}: ${e.message}` : (e as Error).message;
      }
      emit({ local, unit: unit?.name ?? null, unitPid, outsideUnit, health, error }, () => {
        fields([
          ['process', local.running ? `running (pid ${pid})` : 'not running here'],
          ['unit', unit ? `${unit.name}${unitPid ? ` (pid ${unitPid})` : ' (inactive)'}` : undefined],
          ['log', local.log],
          ['version', health ? displayVersion(health.version, health.release?.path) : undefined],
          ['tls', health?.tlsMode],
          ['operator', health?.operatorConfigured === undefined ? undefined : health.operatorConfigured ? 'configured' : style.warn('not configured — run `weave daemon set-password`')],
          ['error', error ? style.bad(error) : undefined],
        ]);
        if (outsideUnit) write(style.warn(`pid ${local.pid} is running outside ${unit!.name} — close the terminal and it stops; restart it under the unit with \`weave daemon stop && weave daemon start\``));
        if (health?.workspaces?.length) {
          write('');
          table(health.workspaces, [
            { header: 'WORKSPACE', get: (w) => String(w.id ?? '') },
            { header: 'NAME', get: (w) => String(w.name ?? '') },
            { header: 'STATUS', get: (w) => String(w.status ?? '') },
          ]);
        }
      });
    }));

  daemon
    .command('logs')
    .description('daemon log')
    .option('-n, --lines <n>', 'lines to show', '80')
    .option('-f, --follow', 'follow the log')
    .action(async (opts: Record<string, string | boolean>) => run(async () => {
      const lines = Number.parseInt(String(opts['lines'] ?? '80'), 10) || 80;
      if (opts['follow'] === true) {
        const follower = followLog((line) => write(line));
        await new Promise<void>((resolve) => {
          process.once('SIGINT', () => { follower.close(); resolve(); });
        });
        return;
      }
      const content = tailLog(lines);
      emit({ file: logFile(), lines: content }, () => {
        if (content.length === 0) write(style.dim(`no log at ${logFile()}`));
        else for (const line of content) write(line);
      });
    }));

  daemon
    .command('set-password')
    .description('set the operator password (first run) or change it')
    .option('-u, --username <username>', 'operator username', 'operator')
    .option('--password <password>', 'the new password (or set AC_PASSWORD); prompts twice when omitted')
    .option('--current <password>', 'the current password when changing it (or set AC_CURRENT_PASSWORD)')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const health = await client.get<Health>('/api/health');
      const username = String(opts['username'] ?? 'operator');
      if (health?.operatorConfigured === false) {
        const given = (typeof opts['password'] === 'string' && opts['password']) || process.env['AC_PASSWORD'];
        const password = given || await promptHidden('New password');
        if (!given) { const again = await promptHidden('Repeat password'); if (password !== again) throw new ApiError('validation', 'passwords do not match', 400); }
        await client.post('/api/auth/setup', { username, password });
        emit({ ok: true, mode: 'setup', publicUrl: health?.publicUrl ?? client.baseUrl }, () => write(`${style.ok('operator configured')} — sign in with \`weave login ${health?.publicUrl ?? client.baseUrl}${health?.tlsMode === 'self-signed' ? ' --pin' : ''}\``));
        return;
      }
      const givenNext = (typeof opts['password'] === 'string' && opts['password']) || process.env['AC_PASSWORD'];
      const givenCurrent = (typeof opts['current'] === 'string' && opts['current']) || process.env['AC_CURRENT_PASSWORD'];
      const current = givenCurrent || await promptHidden('Current password');
      const next = givenNext || await promptHidden('New password');
      if (!givenNext) { const again = await promptHidden('Repeat new password'); if (next !== again) throw new ApiError('validation', 'passwords do not match', 400); }
      await client.post('/api/auth/password', { current, next });
      emit({ ok: true, mode: 'change' }, () => write(style.ok('password changed')));
    }));

  daemon
    .command('install-service')
    .description('write a systemd user unit (or a launchd agent) for the daemon and print the enable commands')
    .option('--print', 'print the unit instead of writing it')
    .option('--launchd', 'write a macOS LaunchAgent plist instead of a systemd unit')
    .addHelpText('after', `
--launchd writes ~/Library/LaunchAgents/${LAUNCHD_LABEL}.plist, but only on macOS;
on any other platform the plist is printed so it can be copied to a Mac.`)
    .action(async (opts: Record<string, boolean>) => run(async () => {
      if (opts['launchd'] === true) {
        const result = opts['print'] === true
          ? { ...installLaunchdAgent(), written: false, plist: renderLaunchdPlist(resolveServerBin()) }
          : installLaunchdAgent();
        emit(result, () => {
          if (!result.written) {
            write(style.dim(`# ${result.path} (not written: ${process.platform === 'darwin' ? '--print' : `this is ${process.platform}, not darwin`})`));
            write(result.plist);
            return;
          }
          write(`${style.ok('wrote')} ${result.path}`);
          reportShim(result.shim);
          write('');
          for (const cmd of result.commands) write(`  ${style.mono(cmd)}`);
        });
        return;
      }
      if (opts['print'] === true) {
        const bin = resolveServerBin();
        const unit = renderServiceUnit(bin);
        emit({ unit, bin }, () => write(unit));
        return;
      }
      const result = installService();
      emit(result, () => {
        write(`${style.ok('wrote')} ${result.path}`);
        reportShim(result.shim);
        write('');
        for (const cmd of result.commands) write(`  ${style.mono(cmd)}`);
      });
    }));

  daemon
    .command('upgrade')
    .description('build a release from git, back up, drain, switch `current` and restart the daemon')
    .option('--from <url|path>', 'git URL or local checkout to build from (default: daemon.yaml upgrade.source)')
    .option('--ref <ref>', 'branch, tag or commit (default: daemon.yaml upgrade.ref, else main)')
    .option('--test', 'run the test suite in the new release before switching')
    .option('--no-restart', 'build and switch only; restart later with `systemctl --user restart` or `weave daemon stop && start`')
    .option('--drain-timeout <sec>', 'seconds to wait for running turns (default: daemon.yaml upgrade.drainTimeoutSec, else 900)')
    .addHelpText('after', `
Releases live in ~/.local/share/weave/releases/<stamp>-<sha>; \`current\` and \`previous\`
are symlinks next to them. The daemon and the CLI both run from \`current\`, never from a checkout,
so agents can edit and build any checkout without touching the running system. Refused inside a
worker run (AC_RUN_TOKEN set): agents propose upgrades through tickets, humans run them.`)
    .action(async (opts: Record<string, string | boolean>, command: Command) => run(async () => {
      if (process.env[AC_ENV.RUN_TOKEN]) throw new ApiError('forbidden', 'weave daemon upgrade is not available inside a worker run; leave it to the human', 403);
      const cfg = readDaemonYaml();
      const from = (typeof opts['from'] === 'string' && opts['from']) || cfg.upgrade?.source;
      if (!from) throw new ApiError('validation', 'no source: pass --from <url|path> or set upgrade.source in daemon.yaml', 400);
      const ref = (typeof opts['ref'] === 'string' && opts['ref']) || cfg.upgrade?.ref || 'main';
      const drainTimeout = Number.parseInt(String(opts['drainTimeout'] ?? cfg.upgrade?.drainTimeoutSec ?? 900), 10);
      const log = (line: string) => write(style.dim(line));

      // VS-407: refuse before building when the restart cannot take — a refused upgrade should not
      // spend a build, and a detached daemon is handed over here rather than after the switch.
      await assertPreflight();

      write(`${style.ok('building')} ${from} @ ${ref}`);
      const built = buildRelease({ from, ref, test: opts['test'] === true, log });
      write(`${style.ok('built')} ${built.path}`);

      const backups = backupDatabases();
      for (const b of backups) write(`${style.dim('backup')} ${b}`);

      const switched = switchRelease(built.path);
      const pruned = pruneReleases(cfg.upgrade?.keep ?? 3);
      write(`${style.ok('current')} -> ${built.path}${switched.previous ? `  (previous: ${switched.previous})` : ''}`);
      if (pruned.length) write(style.dim(`pruned ${pruned.join(', ')}`));

      // VS-377: the release moved, so the PATH shim must follow it (and be created if the host predates it).
      // VS-631: run the *new* release's own writer after the flip, so a shim that release introduces is
      // written on the upgrade that introduces it, not the one after.
      writeShimsFromRelease(built.path);
      const shim = writeUserShims();

      if (opts['restart'] === false) {
        emit({ release: built.path, sha: built.sha, restarted: false, backups, shim }, () => {
          reportShim(shim);
          write(style.warn('not restarted: the running daemon is still the old release'));
        });
        return;
      }
      const result = await drainAndRestart(command, drainTimeout, { release: built.path, sha: built.sha });
      emit({ release: built.path, sha: built.sha, restarted: true, backups, ...result, shim }, () => {
        write(`${style.ok('restarted')} ${result.how} · ${result.version ?? '?'}`);
        if (result.interrupted.length) write(style.warn(`${result.interrupted.length} run(s) were still going and got interrupted; they resume on their own`));
        reportShim(shim);
        write(style.dim('next: weave doctor'));
      });
    }));

  // ---- the deferred, daemon-side upgrade (PLAN §20) ----

  const update = daemon
    .command('update')
    .description('is the release source ahead of the running daemon?')
    .addHelpText('after', `
\`daemon update\` asks the running daemon; \`daemon upgrade\` builds and restarts from this shell.
Use \`update apply\` normally — it waits for every running turn to finish first. Use \`upgrade\`
when the daemon is not answering and has to be replaced from here.`)
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const status = await client.get<UpdateStatus>('/api/daemon/update');
      emit(status, () => renderUpdate(status));
    }));

  update
    .command('apply')
    .description('queue an upgrade on the daemon: it waits for every running turn, then builds and restarts')
    .option('--ref <ref>', 'branch, tag or commit (default: the daemon\'s upgrade.ref)')
    .option('--source <url|path>', 'git URL or local checkout (default: the daemon\'s upgrade.source)')
    .option('--test', 'run the new release\'s test suite before switching to it')
    .option('--no-follow', 'queue it and return instead of following it to a terminal state')
    .action(async (opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const queued = await client.post<Upgrade>('/api/daemon/upgrade', {
        ...(typeof opts['ref'] === 'string' ? { ref: opts['ref'] } : {}),
        ...(typeof opts['source'] === 'string' ? { source: opts['source'] } : {}),
        ...(opts['test'] === true ? { test: true } : {}),
      });
      if (opts['follow'] === false) {
        emit(queued, () => write(`${style.ok('queued')} ${queued.id} · ${queued.source} @ ${queued.ref}`));
        return;
      }
      write(`${style.ok('queued')} ${queued.id} · ${queued.source} @ ${queued.ref}`);
      const final = await followUpgrade(command, queued.id);
      emit(final, () => renderUpgrade(final.upgrade, final.waitingFor));
    }));

  update
    .command('source')
    .argument('<url>', 'git URL or local checkout the daemon should build releases from (use --clear to unset)')
    .description('change where the daemon builds releases from, validated and applied without a restart')
    .option('--ref <ref>', 'branch, tag or commit (default: leave the daemon\'s upgrade.ref as it is)')
    .option('--clear', 'unset the release source (the daemon then reports that update checking is not configured)')
    .addHelpText('after', `
Changed here rather than by hand-editing daemon.yaml: the daemon validates that the source is
reachable and that the ref exists on it, writes the change to daemon.yaml, and applies it to the
running daemon — the next update check and the next upgrade use it with no restart.

A project's repo URL is a separate setting: re-pointing a project does not move the release source.
\`weave daemon update\` warns when the source still names a repository a project has moved away from.`)
    .action(async (url: string, opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const body = opts['clear'] === true
        ? { source: null }
        : { source: url, ...(typeof opts['ref'] === 'string' ? { ref: opts['ref'] } : {}) };
      const status = await client.patch<UpdateStatus>('/api/daemon/update/source', body);
      emit(status, () => {
        write(status.configured
          ? `${style.ok('release source')} ${status.source} @ ${status.ref}`
          : `${style.ok('release source')} ${style.warn('cleared — update checking is not configured')}`);
        if (status.staleSource) write(staleSourceLine(status.staleSource));
      });
    }));

  update
    .command('cancel')
    .description('cancel a queued or waiting upgrade and resume dispatch')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const cancelled = await client.post<Upgrade>('/api/daemon/upgrade/cancel', {});
      emit(cancelled, () => write(`${style.ok('cancelled')} ${cancelled.id} — dispatch resumed`));
    }));

  daemon
    .command('upgrade-runner <upgradeId>', { hidden: true })
    .description('internal: restart the daemon for a deferred upgrade and verify it came back')
    .action(async (upgradeId: string) => run(async () => {
      const verdict = await runUpgradeRunner(upgradeId);
      emit(verdict, () => write(verdict.outcome === 'completed' ? `${style.ok('upgraded')} ${verdict.version ?? '?'}` : style.bad(verdict.message)));
    }));

  // VS-631: the upgrade runs the *new* release's own copy of this command after `current` flips, so a
  // shim that release introduces is written on the upgrade that introduces it.
  daemon
    .command('write-shims', { hidden: true })
    .description('internal: write this release\'s CLI shims (an upgrade calls it after the current symlink flips)')
    .action(async () => run(async () => {
      const shim = writeUserShims();
      emit(shim, () => reportShim(shim));
    }));

  daemon
    .command('releases')
    .description('list built releases and which one is current')
    .action(async () => run(async () => {
      const releases = listReleases();
      emit({ releases, current: readLink(currentLink()), previous: readLink(previousLink()) }, () => {
        if (releases.length === 0) { write(style.dim('no releases yet — `weave daemon upgrade --from <url|path>`')); return; }
        table(releases, [
          { header: '', get: (r) => (r.current ? '*' : r.previous ? '-' : '') },
          { header: 'RELEASE', get: (r) => r.name },
          { header: 'BUILT', get: (r) => r.builtAt },
          { header: 'SHA', get: (r) => r.sha },
        ]);
        write(style.dim('* current   - previous'));
      });
    }));

  daemon
    .command('rollback')
    .description('switch `current` back to `previous` and restart')
    .option('--drain-timeout <sec>', 'seconds to wait for running turns', '900')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      if (process.env[AC_ENV.RUN_TOKEN]) throw new ApiError('forbidden', 'not available inside a worker run', 403);
      const prev = readLink(previousLink());
      if (!prev || !existsSync(prev)) throw new ApiError('not_found', 'no previous release to roll back to', 404);
      // VS-407: refuse before the symlink swing when the restart cannot take.
      await assertPreflight();
      const switched = switchRelease(prev);
      const result = await drainAndRestart(command, Number.parseInt(String(opts['drainTimeout'] ?? '900'), 10), targetOf(prev));
      emit({ release: prev, wasCurrent: switched.previous, ...result }, () => write(`${style.ok('rolled back')} current -> ${prev} · ${result.how}`));
    }));

  const daemonModels = daemon.command('models').description('optional overlays for the weaver, workers, and worker-options on every workspace (VS-185)');
  interface OverlaySetting { runtime?: string; model?: string | null; effort?: string }
  interface OverlayOption extends OverlaySetting { id?: string; description?: string }
  interface DaemonModelsView { weaver: OverlaySetting | null; workers: OverlaySetting | null; workerOptions: OverlayOption[] | null }
  // The CLI's own argument spelling ('weaver'/'workers', with the legacy 'conductor') to the wire field (VS-263, VS-377).
  const wireField = (setting: 'conductor' | 'weaver' | 'workers'): 'weaver' | 'workers' => (setting === 'workers' ? 'workers' : 'weaver');
  const describeSetting = (s: OverlaySetting | null): string => {
    if (!s) return '(per workspace)';
    const parts = [s.runtime ?? '(unset)', s.model ?? '(runtime default)'];
    if (s.effort) parts.push(`effort ${s.effort}`);
    return parts.join(' · ');
  };
  daemonModels
    .command('show', { isDefault: true })
    .description('show daemon model overlays; empty means each workspace uses its own settings')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const current = await client.get<DaemonModelsView>('/api/daemon/models');
      emit(current, () => {
        fields([
          ['weaver', describeSetting(current.weaver)],
          ['workers', describeSetting(current.workers)],
          ...((current.workerOptions ?? []).map((o) => ['option', o.runtime ? `${o.id ?? '?'} — ${o.description ?? ''} (${describeSetting(o)})` : `${o.id ?? '?'} — ${o.description ?? ''} (no runtime chosen)`] as [string, string])),
        ]);
        if (!current.workerOptions?.length) fields([['options', '(per workspace)']]);
      });
    }));
  daemonModels
    .command('set')
    .argument('<setting>', 'weaver or workers (conductor is a deprecated alias)')
    .option('--runtime <id>', 'runtime id')
    .option('--model <id>', 'model id, or "default" to let the runtime choose')
    .option('--effort <effort>', 'reasoning effort, or "default" to clear it')
    .option('--clear', 'remove this overlay so workspaces use their own setting')
    .description('fill or clear one daemon overlay')
    .action(async (setting: string, opts: Record<string, string | boolean | undefined>, command: Command) => run(async () => {
      if (setting !== 'conductor' && setting !== 'weaver' && setting !== 'workers') throw new Error(`unknown setting ${setting}: expected weaver or workers`);
      warnDeprecatedConductor(setting);
      const field = wireField(setting);
      const { client } = await session(command, { workspace: 'none' });
      if (opts['clear'] === true) {
        const result = await client.put<DaemonModelsView>('/api/daemon/models', { [field]: null });
        emit(result, () => write(`${style.ok('cleared')} ${setting} overlay`));
        return;
      }
      const current = await client.get<DaemonModelsView>('/api/daemon/models');
      const next: OverlaySetting = { ...(current[field] ?? {}) };
      if (typeof opts['runtime'] === 'string') next.runtime = opts['runtime'];
      if (typeof opts['model'] === 'string') next.model = opts['model'] === 'default' ? null : opts['model'];
      if (typeof opts['effort'] === 'string') {
        if (opts['effort'] === 'default') delete next.effort;
        else next.effort = opts['effort'];
      }
      if (!next.runtime) throw new Error('pass --runtime (or --clear)');
      const result = await client.put<DaemonModelsView>('/api/daemon/models', { [field]: next });
      emit(result, () => write(`${style.ok('updated')} ${setting} overlay = ${describeSetting(result[field])}`));
    }));
  const overlayOptions = daemonModels.command('options').description('named worker-model options that are the default for a workspace with no catalog of its own (VS-284)');
  overlayOptions
    .command('add')
    .requiredOption('--id <id>', 'kebab-case id')
    .requiredOption('--description <text>', 'when-to-use note')
    .requiredOption('--runtime <id>', 'runtime id')
    .option('--model <id>', 'model id, or "default"')
    .option('--effort <effort>', 'reasoning effort')
    .action(async (opts: Record<string, string | undefined>, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const current = await client.get<DaemonModelsView>('/api/daemon/models');
      const option: OverlayOption = {
        id: opts['id'], description: opts['description'], runtime: opts['runtime'],
        model: opts['model'] === undefined || opts['model'] === 'default' ? null : opts['model'],
      };
      if (opts['effort']) option.effort = opts['effort'];
      const workerOptions = [...(current.workerOptions ?? []), option];
      const result = await client.put<DaemonModelsView>('/api/daemon/models', { workerOptions });
      emit(result, () => write(`${style.ok('added')} overlay option ${option.id}`));
    }));
  overlayOptions
    .command('set')
    .argument('<id>', 'option id to change')
    .option('--description <text>', 'when-to-use note')
    .option('--runtime <id>', 'runtime id')
    .option('--model <id>', 'model id, or "default"')
    .option('--effort <effort>', 'reasoning effort, or "default" to clear it')
    .action(async (id: string, opts: Record<string, string | undefined>, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const current = await client.get<DaemonModelsView>('/api/daemon/models');
      const list = [...(current.workerOptions ?? [])];
      const idx = list.findIndex((o) => o.id === id);
      if (idx < 0) throw new Error(`no overlay option '${id}'`);
      const next = { ...list[idx]! };
      if (opts['description'] !== undefined) next.description = opts['description'];
      if (opts['runtime']) next.runtime = opts['runtime'];
      if (opts['model'] !== undefined) next.model = opts['model'] === 'default' ? null : opts['model'];
      if (opts['effort'] !== undefined) {
        if (opts['effort'] === 'default') delete next.effort;
        else next.effort = opts['effort'];
      }
      list[idx] = next;
      const result = await client.put<DaemonModelsView>('/api/daemon/models', { workerOptions: list });
      emit(result, () => write(`${style.ok('updated')} overlay option ${id}`));
    }));
  overlayOptions
    .command('remove')
    .argument('<id>', 'option id to remove')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const current = await client.get<DaemonModelsView>('/api/daemon/models');
      const workerOptions = (current.workerOptions ?? []).filter((o) => o.id !== id);
      if (workerOptions.length === (current.workerOptions ?? []).length) throw new Error(`no overlay option '${id}'`);
      const result = await client.put<DaemonModelsView>('/api/daemon/models', { workerOptions: workerOptions.length ? workerOptions : [] });
      emit(result, () => write(`${style.ok('removed')} overlay option ${id}`));
    }));
}

function readDaemonYaml(): DaemonYaml {
  try {
    const raw = readFileSync(join(configHome(), 'daemon.yaml'), 'utf8');
    return (parseYaml(raw) ?? {}) as DaemonYaml;
  } catch {
    return {};
  }
}

/** Copy daemon.sqlite and every registered workspace db into <config>/backups/<stamp>/ (sqlite online backup, safe while running). */
/** Exported for its own unit test (VS-258) — this file's copy is independent of `packages/server`'s. */
export function backupDatabases(): string[] {
  const dir = join(configHome(), 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
  const out: string[] = [];
  const sources: Array<{ src: string; name: string }> = [{ src: join(configHome(), 'daemon.sqlite'), name: 'daemon.sqlite' }];
  let workspaces: Array<{ id: string; path: string }> = [];
  try {
    const reg = (parseYaml(readFileSync(join(configHome(), 'workspaces.yaml'), 'utf8')) ?? {}) as { workspaces?: Array<{ id: string; path: string }> };
    workspaces = reg.workspaces ?? [];
  } catch { /* no registry */ }
  // VS-258: not folded into the try above — an ambiguous workspace install must fail this backup
  // loudly, not be swallowed by the registry's own "no registry file" catch.
  for (const w of workspaces) sources.push({ src: join(resolveWorkspaceStateDir(w.path).stateDir, 'db.sqlite'), name: `workspace-${w.id}.sqlite` });
  for (const { src, name } of sources) {
    if (!existsSync(src)) continue;
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, name);
    const r = spawnSync(process.execPath, ['-e', `
      const { DatabaseSync, backup } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1], { readOnly: true });
      backup(db, process.argv[2]).then(() => { db.close(); }).catch((e) => { console.error(e.message); process.exit(1); });
    `, src, dest], { encoding: 'utf8' });
    if (r.status === 0) out.push(dest);
    else { copyFileSync(src, dest); out.push(`${dest} (file copy: ${r.stderr.trim()})`); }
  }
  return out;
}

/**
 * VS-262: `POST /api/daemon/drain` before a kill signal, shared by `daemon stop` and
 * `drainAndRestart` — the drain-before-kill sequence every operator-initiated stop of the daemon
 * goes through. VS-407: in `strict` mode (the restart path) a drain that fails while something is
 * listening on the daemon's own address is refused instead of skipped; only a genuinely empty address
 * is skipped.
 */
async function drainViaHttp(command: Command, drainTimeoutSec: number, o: { strict?: boolean } = {}): Promise<{ interrupted: Array<{ workspace: string; runId: string }>; client: Awaited<ReturnType<typeof session>>['client'] | null }> {
  try {
    const { client } = await session(command, { workspace: 'none' });
    write(style.dim(`draining (up to ${drainTimeoutSec}s for running turns) …`));
    const d = await client.post<{ drained: boolean; running: Array<{ workspace: string; runId: string }> }>('/api/daemon/drain', { timeoutSec: drainTimeoutSec });
    return { interrupted: d.running, client };
  } catch (e) {
    const port = listenPort();
    const holder = port === null ? null : findPortHolder(port, realRun);
    const message = (e as Error).message;
    if (o.strict && holder) {
      throw new ApiError('conflict', `refusing to restart: the drain could not reach the daemon (${message}) but pid ${holder.pid}${holder.command ? ` (${holder.command})` : ''} is still listening on the daemon's address`, 409, { pid: holder.pid });
    }
    write(style.warn(`drain skipped: ${message}${holder ? '' : ' (nothing is listening)'}`));
    return { interrupted: [], client: null };
  }
}

/** The release currently named by a link, as a restart target. */
function targetOf(release: string | null): RestartTarget {
  return { release: release ?? '', sha: release ? releaseSha(release) : null };
}

/** VS-407: refuse (and hand over a detached daemon) before any restart the CLI performs. */
async function assertPreflight(): Promise<void> {
  const verdict = await preflightRestart();
  if (!verdict.ok) throw new ApiError('conflict', verdict.message, 409, { pid: verdict.pid });
  if (verdict.handover.reconciled) write(style.dim(`handover: ${verdict.handover.reason}`));
}

async function drainAndRestart(command: Command, drainTimeoutSec: number, target: RestartTarget): Promise<{ how: string; version: string | null; interrupted: Array<{ workspace: string; runId: string }> }> {
  await assertPreflight();
  const { interrupted, client } = await drainViaHttp(command, drainTimeoutSec, { strict: true });
  let how: string;
  let startedPid: number | null = null;
  // VS-376: restart through whichever unit is actually installed, pre-rename name included. Testing
  // only the current-name file would fall through to a bare kill+spawn, which `Restart=always` would
  // then restart from under us.
  const unit = process.platform === 'linux' ? resolveInstalledUnit() : null;
  if (unit) {
    // VS-388: through the guarded `realRun`, so a test that reaches this cannot restart the live unit.
    const r = realRun('systemctl', ['--user', 'restart', unit.name]);
    if (r.status !== 0) {
      await client?.post('/api/daemon/undrain', {}).catch(() => undefined);
      throw new ApiError('internal', `systemctl --user restart ${unit.name} failed: ${(r.stderr || r.stdout).trim()}`, 500);
    }
    how = `systemctl --user restart ${unit.name}`;
  } else {
    await stopDaemon();
    startedPid = startDaemon({}).pid;
    how = `restarted pid ${startedPid ?? '?'}`;
  }
  // VS-407: not "restarted" until the target release is actually serving from the unit.
  const verdict = await verifyRestart({ unit, target, startedPid });
  if (!verdict.ok) throw new ApiError('internal', verdict.message, 500);
  return { how, version: verdict.version, interrupted };
}

// ---------- the deferred upgrade's client side ----------

interface RunningRelease { version: string; path: string; sha: string | null }
/** VS-830: the configured source still names the repository the running release came from. */
interface StaleSource { configured: string; project: { id: string; slug: string; url: string } }
interface UpdateStatus {
  configured: boolean; running: RunningRelease; source: string | null; ref: string | null;
  targetSha: string | null; updateAvailable: boolean; checkedAt: string | null; error: string | null;
  runtimeSource?: string | null; staleSource?: StaleSource | null;
}
interface WaitingRun { workspace: string; running: number; runIds: string[] }
interface UpgradeStatus { upgrade: Upgrade | null; waitingFor: WaitingRun[] }

/** A human is watching `update apply` scroll; a second is responsive without hammering the daemon. */
const FOLLOW_INTERVAL_MS = 1000;

const short = (sha: string | null): string => (sha ? sha.slice(0, 10) : '?');

function renderUpdate(status: UpdateStatus): void {
  fields([
    ['running', displayVersion(status.running.version, status.running.path)],
    ['release', status.running.path],
    ['source', status.configured ? `${status.source} @ ${status.ref}` : style.warn('not configured — set upgrade.source in daemon.yaml')],
    ['target', status.configured ? short(status.targetSha) : undefined],
    ['checked', status.checkedAt ?? undefined],
    ['error', status.error ? style.bad(status.error) : undefined],
  ]);
  if (status.staleSource) {
    write('');
    write(staleSourceLine(status.staleSource));
  }
  if (!status.configured) return;
  write('');
  write(status.updateAvailable
    ? `${style.ok('update available')} — \`weave daemon update apply\``
    : style.dim('up to date'));
}

/** VS-830: the warning a stale source deserves — silence here was the whole bug. */
function staleSourceLine(stale: StaleSource): string {
  return style.warn(`stale release source: it still names ${stale.configured}, but project ${stale.project.slug} now lives at ${stale.project.url}`)
    + `\n  ${style.dim(`weave daemon update source ${stale.project.url}`)}`;
}

function renderUpgrade(upgrade: Upgrade | null, waitingFor: WaitingRun[]): void {
  if (!upgrade) { write(style.dim('no upgrade has been requested')); return; }
  fields([
    ['upgrade', upgrade.id],
    ['state', upgrade.state],
    ['source', `${upgrade.source} @ ${upgrade.ref}`],
    ['target', short(upgrade.toSha ?? upgrade.targetSha)],
    ['release', upgrade.toRelease ?? undefined],
    ['version', upgrade.cameBackVersion ?? undefined],
    ['reason', upgrade.reason ?? undefined],
    ['message', upgrade.message ?? undefined],
    ['waiting for', waitingFor.length ? waitingFor.map((w) => `${w.workspace}: ${w.running} run(s)`).join(', ') : undefined],
  ]);
  if (upgrade.log.length) {
    write('');
    for (const line of upgrade.log.slice(-20)) write(style.dim(line));
  }
}

/**
 * Follow an upgrade to a terminal state. The daemon restarts partway through, so an unreachable daemon
 * is expected rather than an error: keep polling until it answers again or the deadline passes.
 */
async function followUpgrade(command: Command, upgradeId: string, timeoutMs = 30 * 60 * 1000, intervalMs = FOLLOW_INTERVAL_MS): Promise<UpgradeStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: UpgradeStatus = { upgrade: null, waitingFor: [] };
  let shown = '';
  while (Date.now() < deadline) {
    try {
      const { client } = await session(command, { workspace: 'none' });
      const status = await client.get<UpgradeStatus>('/api/daemon/upgrade');
      if (status.upgrade?.id === upgradeId) {
        last = status;
        if (status.upgrade.state !== shown) {
          shown = status.upgrade.state;
          const waiting = status.waitingFor.map((w) => `${w.workspace}: ${w.running}`).join(', ');
          write(style.dim(`${status.upgrade.state}${waiting ? ` (waiting for ${waiting})` : ''}`));
        }
        if (isTerminalUpgrade(status.upgrade.state)) return status;
      }
    } catch {
      if (shown !== 'restarting') { shown = 'restarting'; write(style.dim('daemon unreachable — restarting')); }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}
