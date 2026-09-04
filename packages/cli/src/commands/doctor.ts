/** `oc doctor` — the checklist that tells a human exactly what is missing (PLAN §20). */
import type { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { ApiError } from '../api.js';
import { emit, style, write } from '../output.js';
import { contextsPath, currentContext } from '../contexts.js';
import { isRunning, readPid } from '../daemon.js';
import { items, run, session } from './util.js';

interface Check { name: string; ok: boolean | null; detail: string; fix?: string }

function localTool(binary: string, args: string[]): { ok: boolean; detail: string } {
  try {
    const out = execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true, detail: out.split('\n')[0]?.trim() ?? '' };
  } catch {
    return { ok: false, detail: 'not found' };
  }
}

export function register(program: Command): void {
  program
    .command('doctor')
    .description('check the daemon, runtimes and this machine')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const checks: Check[] = [];
      const ctx = currentContext();
      checks.push({
        name: 'context',
        ok: ctx.entry !== null,
        detail: ctx.entry ? `${ctx.name} -> ${ctx.entry.url}` : `none in ${contextsPath()}`,
        fix: ctx.entry ? undefined : 'oc login <url>',
      });

      const pid = readPid();
      checks.push({ name: 'local daemon process', ok: isRunning(pid) ? true : null, detail: isRunning(pid) ? `running (pid ${pid})` : 'not started from this machine', fix: 'oc daemon start' });

      const node = process.versions.node;
      checks.push({ name: 'node', ok: Number(node.split('.')[0]) >= 22, detail: `v${node}`, fix: 'install Node 22 or newer' });
      const git = localTool('git', ['--version']);
      checks.push({ name: 'git', ok: git.ok, detail: git.detail, fix: 'install git' });
      const gh = localTool('gh', ['--version']);
      checks.push({ name: 'gh', ok: gh.ok ? true : null, detail: gh.detail, fix: 'install gh for pull-request delivery' });

      let health: Record<string, unknown> | null = null;
      let runtimes: Array<Record<string, unknown>> = [];
      try {
        const { client } = await session(command, { workspace: 'optional' });
        health = await client.get<Record<string, unknown>>('/api/health');
        checks.push({ name: 'daemon api', ok: true, detail: `${client.baseUrl} · v${String(health['version'] ?? '?')} · tls ${String(health['tlsMode'] ?? 'none')}` });
        checks.push({
          name: 'operator password',
          ok: health['operatorConfigured'] === true,
          detail: health['operatorConfigured'] === true ? 'configured' : 'not configured',
          fix: 'oc daemon set-password',
        });
        const workspaces = items<Record<string, unknown>>(health['workspaces']);
        checks.push({ name: 'workspaces', ok: workspaces.length > 0, detail: workspaces.map((w) => String(w['id'])).join(', ') || 'none', fix: 'oc init <dir>' });
        runtimes = items<Record<string, unknown>>(await client.get('/api/runtimes'), 'runtimes');
        for (const runtime of runtimes) {
          const detection = (runtime['detection'] ?? {}) as Record<string, unknown>;
          checks.push({
            name: `runtime ${String(runtime['id'] ?? '?')}`,
            ok: detection['available'] === true ? true : detection['available'] === false ? false : null,
            detail: String(detection['version'] ?? detection['notes'] ?? (detection['available'] === false ? 'not installed on the daemon host' : 'unknown')),
            fix: detection['available'] === false ? `install it on the daemon host, then \`oc runtime login ${String(runtime['id'] ?? '')}\`` : undefined,
          });
        }
      } catch (error) {
        const message = error instanceof ApiError ? `${String(error.code).toUpperCase()}: ${error.message}` : (error as Error).message;
        checks.push({ name: 'daemon api', ok: false, detail: message, fix: 'oc daemon start' });
      }

      const failed = checks.filter((c) => c.ok === false).length;
      emit({ checks, failed }, () => {
        for (const check of checks) {
          const mark = check.ok === true ? style.ok('ok  ') : check.ok === false ? style.bad('fail') : style.warn('warn');
          write(`${mark}  ${check.name.padEnd(22)}  ${check.detail}`);
          if (check.ok !== true && check.fix) write(`      ${style.dim(`-> ${check.fix}`)}`);
        }
        write('');
        write(failed === 0 ? style.ok('everything checks out') : style.bad(`${failed} check${failed === 1 ? '' : 's'} failed`));
      });
      if (failed > 0) process.exitCode = 1;
    }));
}
