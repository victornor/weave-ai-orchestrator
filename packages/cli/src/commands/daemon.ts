/** `oc daemon start|stop|status|logs|set-password|install-service` (PLAN §20). */
import type { Command } from 'commander';
import { ApiError } from '../api.js';
import { emit, fields, style, table, write } from '../output.js';
import { promptHidden } from '../prompt.js';
import { followLog, installService, isRunning, logFile, pidFile, readPid, resolveServerBin, startDaemon, stopDaemon, tailLog } from '../daemon.js';
import { run, session } from './util.js';

interface Health { ok?: boolean; version?: string; workspaces?: Array<{ id?: string; name?: string; status?: string }>; operatorConfigured?: boolean; tlsMode?: string }

export function register(program: Command): void {
  const daemon = program.command('daemon').description('daemon lifecycle on this machine');

  daemon
    .command('start')
    .description('start the OpenConductor daemon')
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
      emit({ started: true, ...result }, () => {
        if (result.foreground) return;
        write(`${style.ok('started')} pid ${result.pid}`);
        fields([['bin', result.bin], ['log', result.log], ['next', 'oc daemon status']]);
      });
    }));

  daemon
    .command('stop')
    .description('stop the daemon started from this machine')
    .action(async () => run(async () => {
      const result = await stopDaemon();
      emit(result, () => write(result.stopped ? `${style.ok('stopped')} pid ${result.pid}` : 'not running'));
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
          ['version', health?.version],
          ['tls', health?.tlsMode],
          ['operator', health?.operatorConfigured === undefined ? undefined : health.operatorConfigured ? 'configured' : style.warn('not configured — run `oc daemon set-password`')],
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
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'none' });
      const health = await client.get<Health>('/api/health');
      const username = String(opts['username'] ?? 'operator');
      if (health?.operatorConfigured === false) {
        const password = await promptHidden('New password');
        const again = await promptHidden('Repeat password');
        if (password !== again) throw new ApiError('validation', 'passwords do not match', 400);
        await client.post('/api/auth/setup', { username, password });
        emit({ ok: true, mode: 'setup' }, () => write(`${style.ok('operator configured')} — sign in with \`oc login ${client.baseUrl}\``));
        return;
      }
      const current = await promptHidden('Current password');
      const next = await promptHidden('New password');
      const again = await promptHidden('Repeat new password');
      if (next !== again) throw new ApiError('validation', 'passwords do not match', 400);
      await client.post('/api/auth/password', { current, next });
      emit({ ok: true, mode: 'change' }, () => write(style.ok('password changed')));
    }));

  daemon
    .command('install-service')
    .description('write a systemd user unit for the daemon and print the enable commands')
    .option('--print', 'print the unit instead of writing it')
    .action(async (opts: Record<string, boolean>) => run(async () => {
      if (opts['print'] === true) {
        const bin = resolveServerBin();
        const { renderServiceUnit } = await import('../daemon.js');
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
}
