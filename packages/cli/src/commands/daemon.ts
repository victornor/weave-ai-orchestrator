/** `conductor daemon start|stop|status|logs|set-password|install-service` (PLAN §20). */
import type { Command } from 'commander';
import { ApiError } from '../api.js';
import { emit, fields, style, table, write } from '../output.js';
import { promptHidden } from '../prompt.js';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { join } from 'node:path';
import { configHome } from '../contexts.js';
import { LAUNCHD_LABEL, SERVICE_NAME, followLog, installLaunchdAgent, installService, isRunning, logFile, pidFile, readPid, renderLaunchdPlist, renderServiceUnit, resolveServerBin, serviceUnitPath, startDaemon, stopDaemon, tailLog } from '../daemon.js';
import { buildRelease, currentLink, listReleases, previousLink, pruneReleases, readLink, releaseStamp, resolveWorkspaceStateDir, switchRelease } from '../release.js';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { AC_ENV, isTerminalUpgrade, type Upgrade } from '@agent-conductor/shared';
import { run, session } from './util.js';
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
interface DaemonYaml { upgrade?: { source?: string; ref?: string; keep?: number; drainTimeoutSec?: number } }

export function register(program: Command): void {
  const daemon = program.command('daemon').description('daemon lifecycle on this machine');

  daemon
    .command('start')
    .description('start the AgentConductor daemon')
    .option('-f, --foreground', 'run in the foreground and stream logs here')
    .option('--listen <addr>', 'override the listen address, e.g. 127.0.0.1:7433')
    .action(async (opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const existing = readPid();
      if (isRunning(existing)) {
        emit({ started: false, pid: existing, reason: 'already running' }, () => write(`${style.dim('already running')} pid ${existing}`));
        return;
      }
      const result = startDaemon({
        foreground: opts['foreground'] === true,
        ...(typeof opts['listen'] === 'string' ? { listen: opts['listen'] } : {}),
      });
      let ready: { publicUrl?: string; setupRequired?: boolean } | null = null;
      if (!result.foreground && result.pid) {
        // Wait until the daemon has written its daemon.json (it is listening) or died (port in use, bad config …).
        const marker = join(configHome(), 'daemon.json');
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          if (!isRunning(result.pid)) {
            let tail = '';
            try { tail = readFileSync(result.log, 'utf8').trim().split('\n').slice(-8).join('\n'); } catch { /* no log */ }
            throw new ApiError('internal', `the daemon exited right after starting (see ${result.log})`, 500, { logTail: tail });
          }
          try {
            const j = JSON.parse(readFileSync(marker, 'utf8')) as { pid?: number; publicUrl?: string; setupRequired?: boolean };
            if (j.pid === result.pid) { ready = j; break; }
          } catch { /* not yet */ }
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      emit({ started: true, ...result, publicUrl: ready?.publicUrl ?? null }, () => {
        if (result.foreground) return;
        write(`${style.ok(ready ? 'started' : 'started (not confirmed yet)')} pid ${result.pid}`);
        if (ready?.setupRequired) write(style.warn('public listener held: no operator password yet — run `conductor daemon set-password` on this machine to open it'));
        fields([['url', ready?.setupRequired ? `${ready.publicUrl ?? ''} (after set-password)` : ready?.publicUrl ?? '(pending)'], ['bin', result.bin], ['log', result.log], ['next', ready?.setupRequired ? 'conductor daemon set-password' : 'conductor daemon status']]);
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
      const result = await drainAndRestart(command, Number.parseInt(String(opts['drainTimeout'] ?? '900'), 10));
      emit(result, () => write(`${style.ok('restarted')} ${result.how} · ${result.version ?? '?'}`));
    }));

  daemon
    .command('status')
    .description('local process state plus GET /api/health')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const pid = readPid();
      const local = { pid, running: isRunning(pid), pidFile: pidFile(), log: logFile() };
      let health: Health | null = null;
      let error: string | null = null;
      try {
        const { client } = await session(command, { workspace: 'none' });
        health = await client.get<Health>('/api/health');
      } catch (e) {
        error = e instanceof ApiError ? `${String(e.code).toUpperCase()}: ${e.message}` : (e as Error).message;
      }
      emit({ local, health, error }, () => {
        fields([
          ['process', local.running ? `running (pid ${pid})` : 'not running here'],
          ['log', local.log],
          ['version', health ? displayVersion(health.version, health.release?.path) : undefined],
          ['tls', health?.tlsMode],
          ['operator', health?.operatorConfigured === undefined ? undefined : health.operatorConfigured ? 'configured' : style.warn('not configured — run `conductor daemon set-password`')],
          ['error', error ? style.bad(error) : undefined],
        ]);
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
        emit({ ok: true, mode: 'setup', publicUrl: health?.publicUrl ?? client.baseUrl }, () => write(`${style.ok('operator configured')} — sign in with \`conductor login ${health?.publicUrl ?? client.baseUrl}${health?.tlsMode === 'self-signed' ? ' --pin' : ''}\``));
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
    .option('--no-restart', 'build and switch only; restart later with `systemctl --user restart` or `conductor daemon stop && start`')
    .option('--drain-timeout <sec>', 'seconds to wait for running turns (default: daemon.yaml upgrade.drainTimeoutSec, else 900)')
    .addHelpText('after', `
Releases live in ~/.local/share/agent-conductor/releases/<stamp>-<sha>; \`current\` and \`previous\`
are symlinks next to them. The daemon and the CLI both run from \`current\`, never from a checkout,
so agents can edit and build any checkout without touching the running system. Refused inside a
worker run (AC_RUN_TOKEN set): agents propose upgrades through tickets, humans run them.`)
    .action(async (opts: Record<string, string | boolean>, command: Command) => run(async () => {
      if (process.env[AC_ENV.RUN_TOKEN]) throw new ApiError('forbidden', 'conductor daemon upgrade is not available inside a worker run; leave it to the human', 403);
      const cfg = readDaemonYaml();
      const from = (typeof opts['from'] === 'string' && opts['from']) || cfg.upgrade?.source;
      if (!from) throw new ApiError('validation', 'no source: pass --from <url|path> or set upgrade.source in daemon.yaml', 400);
      const ref = (typeof opts['ref'] === 'string' && opts['ref']) || cfg.upgrade?.ref || 'main';
      const drainTimeout = Number.parseInt(String(opts['drainTimeout'] ?? cfg.upgrade?.drainTimeoutSec ?? 900), 10);
      const log = (line: string) => write(style.dim(line));

      write(`${style.ok('building')} ${from} @ ${ref}`);
      const built = buildRelease({ from, ref, test: opts['test'] === true, log });
      write(`${style.ok('built')} ${built.path}`);

      const backups = backupDatabases();
      for (const b of backups) write(`${style.dim('backup')} ${b}`);

      const switched = switchRelease(built.path);
      const pruned = pruneReleases(cfg.upgrade?.keep ?? 3);
      write(`${style.ok('current')} -> ${built.path}${switched.previous ? `  (previous: ${switched.previous})` : ''}`);
      if (pruned.length) write(style.dim(`pruned ${pruned.join(', ')}`));

      if (opts['restart'] === false) {
        emit({ release: built.path, sha: built.sha, restarted: false, backups }, () => write(style.warn('not restarted: the running daemon is still the old release')));
        return;
      }
      const result = await drainAndRestart(command, drainTimeout);
      emit({ release: built.path, sha: built.sha, restarted: true, backups, ...result }, () => {
        write(`${style.ok('restarted')} ${result.how} · ${result.version ?? '?'}`);
        if (result.interrupted.length) write(style.warn(`${result.interrupted.length} run(s) were still going and got interrupted; they resume on their own`));
        write(style.dim('next: conductor doctor'));
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

  daemon
    .command('releases')
    .description('list built releases and which one is current')
    .action(async () => run(async () => {
      const releases = listReleases();
      emit({ releases, current: readLink(currentLink()), previous: readLink(previousLink()) }, () => {
        if (releases.length === 0) { write(style.dim('no releases yet — `conductor daemon upgrade --from <url|path>`')); return; }
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
      const switched = switchRelease(prev);
      const result = await drainAndRestart(command, Number.parseInt(String(opts['drainTimeout'] ?? '900'), 10));
      emit({ release: prev, wasCurrent: switched.previous, ...result }, () => write(`${style.ok('rolled back')} current -> ${prev} · ${result.how}`));
    }));

  const daemonModels = daemon.command('models').description('optional overlays for conductor, workers, and worker-options on every workspace (VS-185)');
  interface OverlaySetting { runtime?: string; model?: string | null; effort?: string }
  interface OverlayOption extends OverlaySetting { id?: string; description?: string }
  interface DaemonModelsView { conductor: OverlaySetting | null; workers: OverlaySetting | null; workerOptions: OverlayOption[] | null }
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
          ['conductor', describeSetting(current.conductor)],
          ['workers', describeSetting(current.workers)],
          ...((current.workerOptions ?? []).map((o) => ['option', o.runtime ? `${o.id ?? '?'} — ${o.description ?? ''} (${describeSetting(o)})` : `${o.id ?? '?'} — ${o.description ?? ''} (no runtime chosen)`] as [string, string])),
        ]);
        if (!current.workerOptions?.length) fields([['options', '(per workspace)']]);
      });
    }));
  daemonModels
    .command('set')
    .argument('<setting>', 'conductor or workers')
    .option('--runtime <id>', 'runtime id')
    .option('--model <id>', 'model id, or "default" to let the runtime choose')
    .option('--effort <effort>', 'reasoning effort, or "default" to clear it')
    .option('--clear', 'remove this overlay so workspaces use their own setting')
    .description('fill or clear one daemon overlay')
    .action(async (setting: string, opts: Record<string, string | boolean | undefined>, command: Command) => run(async () => {
      if (setting !== 'conductor' && setting !== 'workers') throw new Error(`unknown setting ${setting}: expected conductor or workers`);
      const { client } = await session(command, { workspace: 'none' });
      if (opts['clear'] === true) {
        const result = await client.put<DaemonModelsView>('/api/daemon/models', { [setting]: null });
        emit(result, () => write(`${style.ok('cleared')} ${setting} overlay`));
        return;
      }
      const current = await client.get<DaemonModelsView>('/api/daemon/models');
      const next: OverlaySetting = { ...(current[setting] ?? {}) };
      if (typeof opts['runtime'] === 'string') next.runtime = opts['runtime'];
      if (typeof opts['model'] === 'string') next.model = opts['model'] === 'default' ? null : opts['model'];
      if (typeof opts['effort'] === 'string') {
        if (opts['effort'] === 'default') delete next.effort;
        else next.effort = opts['effort'];
      }
      if (!next.runtime) throw new Error('pass --runtime (or --clear)');
      const result = await client.put<DaemonModelsView>('/api/daemon/models', { [setting]: next });
      emit(result, () => write(`${style.ok('updated')} ${setting} overlay = ${describeSetting(result[setting])}`));
    }));
  const overlayOptions = daemonModels.command('options').description('named worker-model options that override every workspace catalog');
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
 * goes through. A failure here (daemon unreachable, already down) is swallowed rather than blocking
 * the stop/restart that follows.
 */
async function drainViaHttp(command: Command, drainTimeoutSec: number): Promise<{ interrupted: Array<{ workspace: string; runId: string }>; client: Awaited<ReturnType<typeof session>>['client'] | null }> {
  try {
    const { client } = await session(command, { workspace: 'none' });
    write(style.dim(`draining (up to ${drainTimeoutSec}s for running turns) …`));
    const d = await client.post<{ drained: boolean; running: Array<{ workspace: string; runId: string }> }>('/api/daemon/drain', { timeoutSec: drainTimeoutSec });
    return { interrupted: d.running, client };
  } catch (e) {
    write(style.warn(`drain skipped: ${(e as Error).message}`));
    return { interrupted: [], client: null };
  }
}

async function drainAndRestart(command: Command, drainTimeoutSec: number): Promise<{ how: string; version: string | null; interrupted: Array<{ workspace: string; runId: string }> }> {
  const { interrupted, client } = await drainViaHttp(command, drainTimeoutSec);
  let how: string;
  const unitInstalled = existsSync(serviceUnitPath()) && process.platform === 'linux';
  if (unitInstalled) {
    const r = spawnSync('systemctl', ['--user', 'restart', SERVICE_NAME], { encoding: 'utf8' });
    if (r.status !== 0) {
      await client?.post('/api/daemon/undrain', {}).catch(() => undefined);
      throw new ApiError('internal', `systemctl --user restart ${SERVICE_NAME} failed: ${r.stderr.trim()}`, 500);
    }
    how = `systemctl --user restart ${SERVICE_NAME}`;
  } else {
    await stopDaemon();
    const started = startDaemon({});
    how = `restarted pid ${started.pid}`;
  }
  // Wait for the new daemon to answer.
  let version: string | null = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const { client: fresh } = await session(command, { workspace: 'none' });
      const h = await fresh.get<Health>('/api/health');
      version = h.version ?? null;
      break;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  return { how, version, interrupted };
}

// ---------- the deferred upgrade's client side ----------

interface RunningRelease { version: string; path: string; sha: string | null }
interface UpdateStatus {
  configured: boolean; running: RunningRelease; source: string | null; ref: string | null;
  targetSha: string | null; updateAvailable: boolean; checkedAt: string | null; error: string | null;
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
  if (!status.configured) return;
  write('');
  write(status.updateAvailable
    ? `${style.ok('update available')} — \`conductor daemon update apply\``
    : style.dim('up to date'));
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
