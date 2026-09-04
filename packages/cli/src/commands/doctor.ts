/** `conductor doctor [--install]` — the checklist that tells a human exactly what is missing (PLAN §20). */
import type { Command } from 'commander';
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { hostname } from 'node:os';
import { delimiter, join } from 'node:path';
import { ApiError } from '../api.js';
import { emit, style, write } from '../output.js';
import { contextsPath, currentContext } from '../contexts.js';
import { isRunning, readPid } from '../daemon.js';
import { promptConfirm } from '../prompt.js';
import { isInstallable, planInstalls, type InstallStep, type InstallableId } from '../install.js';
import { items, run, session } from './util.js';

interface Check { name: string; ok: boolean | null; detail: string; fix?: string; install?: InstallableId }
interface HostTool { id: string; available: boolean; version: string | null; need: 'required' | 'recommended'; purpose: string }
interface HealthHost { platform?: string; hostname?: string; tools?: Record<string, HostTool> }

function localTool(binary: string, args: string[]): { ok: boolean; detail: string } {
  try {
    const out = execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, NO_COLOR: '1' } });
    return { ok: true, detail: out.split('\n')[0]?.trim() ?? '' };
  } catch {
    return { ok: false, detail: 'not found' };
  }
}

/** Is `binary` on PATH? Looks, does not execute. */
export function onPath(binary: string): boolean {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try { accessSync(join(dir, binary + ext), constants.X_OK); return true; } catch { /* next */ }
    }
  }
  return false;
}

const LOCAL_TOOLS: Array<{ id: InstallableId; binary: string; args: string[]; fix: string }> = [
  { id: 'gh', binary: 'gh', args: ['--version'], fix: 'install gh for pull-request delivery (deliveryMode: pr)' },
  { id: 'openspec', binary: process.env['AC_OPENSPEC_BIN'] ?? 'openspec', args: ['--version'], fix: 'npm install -g @fission-ai/openspec — without it change tickets skip spec validation and archiving' },
  { id: 'wt', binary: 'wt', args: ['--version'], fix: 'install worktrunk (cargo install worktrunk / brew install worktrunk / pacman -S worktrunk) — until then the plain git worktree fallback is used' },
];

export function register(program: Command): void {
  program
    .command('doctor')
    .description('check the daemon, runtimes and this machine')
    .option('--install', 'offer to install what is missing on this machine (npm/brew/cargo only, never sudo)')
    .option('-y, --yes', 'with --install: do not ask before each install')
    .action(async (opts: Record<string, boolean>, command: Command) => run(async () => {
      const checks: Check[] = [];
      const ctx = currentContext();
      checks.push({
        name: 'context',
        ok: ctx.entry !== null,
        detail: ctx.entry ? `${ctx.name} -> ${ctx.entry.url}` : `none in ${contextsPath()}`,
        fix: ctx.entry ? undefined : 'conductor login <url>',
      });

      const pid = readPid();
      checks.push({ name: 'local daemon process', ok: isRunning(pid) ? true : null, detail: isRunning(pid) ? `running (pid ${pid})` : 'not started from this machine', fix: 'conductor daemon start' });

      const node = process.versions.node;
      checks.push({ name: 'node', ok: Number(node.split('.')[0]) >= 22, detail: `v${node}`, fix: 'install Node 22 or newer' });
      const git = localTool('git', ['--version']);
      checks.push({ name: 'git', ok: git.ok, detail: git.detail, fix: 'install git' });
      for (const tool of LOCAL_TOOLS) {
        const r = localTool(tool.binary, tool.args);
        checks.push({ name: tool.id === 'wt' ? 'worktrunk (wt)' : tool.id, ok: r.ok ? true : null, detail: r.detail, fix: tool.fix, install: r.ok ? undefined : tool.id });
      }

      let daemonIsThisHost: boolean | null = null;
      let remoteHost: string | null = null;
      try {
        const { client } = await session(command, { workspace: 'optional' });
        const health = await client.get<Record<string, unknown>>('/api/health');
        checks.push({ name: 'daemon api', ok: true, detail: `${client.baseUrl} · v${String(health['version'] ?? '?')} · tls ${String(health['tlsMode'] ?? 'none')}` });
        checks.push({
          name: 'operator password',
          ok: health['operatorConfigured'] === true,
          detail: health['operatorConfigured'] === true ? 'configured' : 'not configured',
          fix: 'conductor daemon set-password',
        });
        const workspaces = items<Record<string, unknown>>(health['workspaces']);
        checks.push({ name: 'workspaces', ok: workspaces.length > 0, detail: workspaces.map((w) => String(w['id'])).join(', ') || 'none', fix: 'conductor init <dir>' });

        const host = (health['host'] ?? null) as HealthHost | null;
        daemonIsThisHost = host?.hostname ? host.hostname === hostname() : isRunning(pid);
        if (host?.tools && !daemonIsThisHost) {
          remoteHost = host.hostname ?? client.baseUrl;
          for (const tool of Object.values(host.tools)) {
            checks.push({
              name: `daemon host: ${tool.id === 'wt' ? 'worktrunk (wt)' : tool.id}`,
              ok: tool.available ? true : tool.need === 'required' ? false : null,
              detail: tool.available ? `${tool.version ?? 'present'} on ${remoteHost}` : `missing on ${remoteHost} — ${tool.purpose}`,
              fix: tool.available ? undefined : `install ${tool.id} on ${remoteHost} (run \`conductor doctor --install\` there)`,
            });
          }
        }

        const runtimes = items<Record<string, unknown>>(await client.get('/api/runtimes'), 'runtimes');
        for (const runtime of runtimes) {
          const id = String(runtime['id'] ?? '?');
          const detection = (runtime['detection'] ?? {}) as Record<string, unknown>;
          const available = detection['status'] === 'available' || detection['available'] === true;
          const missing = detection['status'] === 'missing_binary' || detection['status'] === 'broken' || detection['available'] === false;
          checks.push({
            name: `runtime ${id}`,
            ok: available ? true : missing ? false : null,
            detail: String(detection['version'] ?? detection['notes'] ?? (missing ? 'not installed on the daemon host' : 'unknown')),
            fix: missing ? `install it on the daemon host, then \`conductor runtime login ${id}\`` : undefined,
            install: missing && daemonIsThisHost && isInstallable(id) ? id : undefined,
          });
        }
      } catch (error) {
        const message = error instanceof ApiError ? `${String(error.code).toUpperCase()}: ${error.message}` : (error as Error).message;
        checks.push({ name: 'daemon api', ok: false, detail: message, fix: 'conductor daemon start' });
      }

      const failed = checks.filter((c) => c.ok === false).length;
      const installable = [...new Set(checks.flatMap((c) => (c.install ? [c.install] : [])))];
      emit({ checks, failed, installable }, () => {
        for (const check of checks) {
          const mark = check.ok === true ? style.ok('ok  ') : check.ok === false ? style.bad('fail') : style.warn('warn');
          write(`${mark}  ${check.name.padEnd(26)}  ${check.detail}`);
          if (check.ok !== true && check.fix) write(`      ${style.dim(`-> ${check.fix}`)}`);
        }
        write('');
        write(failed === 0 ? style.ok('everything checks out') : style.bad(`${failed} check${failed === 1 ? '' : 's'} failed`));
        if (installable.length > 0 && opts['install'] !== true) write(style.dim(`installable here: ${installable.join(', ')} — run \`conductor doctor --install\``));
        if (remoteHost && opts['install'] === true) write(style.dim(`the daemon runs on ${remoteHost}; --install only touches this machine`));
      });
      if (failed > 0) process.exitCode = 1;

      if (opts['install'] === true) await installMissing(installable, opts['yes'] === true);
    }));
}

async function installMissing(ids: InstallableId[], yes: boolean): Promise<void> {
  if (ids.length === 0) { write(style.dim('nothing to install on this machine')); return; }
  const steps = planInstalls(ids, { platform: process.platform, has: onPath });
  const results: Array<{ id: InstallableId; status: 'installed' | 'failed' | 'skipped' | 'manual'; detail: string }> = [];
  write('');
  for (const step of steps) {
    if (!step.command) {
      write(`${style.warn('manual')}  ${step.id.padEnd(10)}  ${step.manual}`);
      results.push({ id: step.id, status: 'manual', detail: step.manual });
      continue;
    }
    const rendered = step.command.join(' ');
    if (!yes && !(await promptConfirm(`install ${step.id} (${step.why}) with \`${rendered}\`?`, true))) {
      results.push({ id: step.id, status: 'skipped', detail: rendered });
      continue;
    }
    write(`${style.dim('$')} ${rendered}`);
    const r = spawnSync(step.command[0]!, step.command.slice(1), { stdio: 'inherit', env: process.env });
    const ok = r.status === 0;
    results.push({ id: step.id, status: ok ? 'installed' : 'failed', detail: ok ? rendered : `${rendered} exited ${String(r.status ?? r.signal ?? '?')}` });
    write(ok ? `${style.ok('installed')} ${step.id}` : `${style.bad('failed')} ${step.id} — ${r.error?.message ?? `exit ${String(r.status)}`}; try: ${step.manual}`);
  }
  const afterthoughts = results.filter((r) => r.status === 'installed' && ['claude', 'codex', 'opencode', 'gemini'].includes(r.id));
  if (afterthoughts.length > 0) write(style.dim(`next: ${afterthoughts.map((r) => `conductor runtime login ${r.id}`).join(' · ')}`));
  if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
}

export type { InstallStep };
