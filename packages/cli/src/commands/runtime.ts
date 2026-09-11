/** `conductor runtime list|detect|login` — runtime availability and per-workspace auth (PLAN §8.3, §20). */
import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ApiError } from '../api.js';
import { emit, fields, style, table, write } from '../output.js';
import { resolveWorkspaceStateDir } from '../release.js';
import { items, run, session } from './util.js';

interface RuntimeDescriptor {
  id?: string;
  displayName?: string;
  detection?: { status?: string; available?: boolean; version?: string | null; path?: string | null; notes?: string | null };
  capabilities?: Record<string, unknown>;
  models?: Array<{ id?: string; label?: string; source?: string } | string>;
  /** Optional, daemon-provided: how to log this runtime in inside its per-workspace config home. */
  login?: { command?: string; args?: string[]; env?: Record<string, string>; instructions?: string[] };
  configHomeEnv?: string;
}

/** Fallback table when the daemon does not describe the login flow (PLAN §8.3 "Isolation of config"). */
const FALLBACK: Record<string, { env: string; command: string[]; instructions: string[] }> = {
  claude: { env: 'CLAUDE_CONFIG_DIR', command: ['claude', 'setup-token'], instructions: ['Claude Code stores its credentials in the config dir; `claude setup-token` writes a long-lived token there.'] },
  codex: { env: 'CODEX_HOME', command: ['codex', 'login'], instructions: ['Codex writes its auth into CODEX_HOME; the browser flow opens automatically.'] },
  opencode: { env: 'XDG_CONFIG_HOME', command: ['opencode', 'auth', 'login'], instructions: ['OpenCode keeps provider credentials under XDG_CONFIG_HOME/opencode.'] },
  gemini: { env: 'GEMINI_CLI_HOME', command: ['gemini'], instructions: ['Gemini CLI prompts for auth on first run; pick "Login with Google" or set an API key.'] },
  cursor: { env: 'CURSOR_CONFIG_DIR', command: ['cursor-agent', 'login'], instructions: ['Cursor CLI stores auth in auth.json under CURSOR_CONFIG_DIR; `cursor-agent login` opens the browser flow.'] },
};

function detectionCell(r: RuntimeDescriptor): string {
  const d = r.detection ?? {};
  if (d.status === 'available' || d.available === true) return style.ok(`available${d.version ? ` ${d.version}` : ''}`);
  if (d.status === 'missing_binary' || d.available === false) return style.bad('missing');
  if (d.status === 'broken' || d.status === 'unsupported') return style.bad(`${d.status}${d.notes ? ` (${d.notes})` : ''}`);
  return style.dim('unknown');
}

export function register(program: Command): void {
  const runtime = program.command('runtime').description('coding CLIs available to this daemon');

  const listAction = async (_opts: unknown, command: Command) => run(async () => {
    const { client } = await session(command, { workspace: 'optional' });
    const payload = await client.get('/api/runtimes');
    const rows = items<RuntimeDescriptor>(payload, 'runtimes');
    emit(payload, () => {
      table(rows, [
        { header: 'ID', get: (r) => String(r.id ?? '') },
        { header: 'NAME', get: (r) => String(r.displayName ?? '') },
        { header: 'DETECTED', get: detectionCell },
        { header: 'PATH', get: (r) => String(r.detection?.path ?? '') },
        { header: 'MODELS', get: (r) => String(r.models?.length ?? 0), align: 'right' },
      ], { empty: 'no runtimes registered' });
    });
  });

  runtime.command('list', { isDefault: true }).description('list runtimes and their models').action(listAction);
  runtime.command('detect').description('re-run runtime detection').action(listAction);

  runtime
    .command('models')
    .argument('<id>')
    .description('models offered by a runtime')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command, { workspace: 'optional' });
      const payload = await client.get(`/api/runtimes/${encodeURIComponent(id)}/models`);
      const rows = items<{ id?: string; label?: string; source?: string } | string>(payload, 'models');
      emit(payload, () => {
        table(rows.map((m) => (typeof m === 'string' ? { id: m } : m)), [
          { header: 'MODEL', get: (m) => String(m.id ?? '') },
          { header: 'LABEL', get: (m) => String(m.label ?? '') },
          { header: 'SOURCE', get: (m) => String(m.source ?? '') },
        ], { empty: 'no models reported' });
      });
    }));

  runtime
    .command('login')
    .argument('<id>')
    .description("print the runtime's login instructions and run its CLI inside the workspace config home")
    .option('--print', 'print the instructions without running anything')
    .action(async (id: string, opts: Record<string, boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const runtimes = items<RuntimeDescriptor>(await client.get('/api/runtimes'), 'runtimes');
      const descriptor = runtimes.find((r) => r.id === id);
      if (!descriptor) throw new ApiError('not_found', `unknown runtime: ${id}`, 404, { known: runtimes.map((r) => r.id) });

      const workspace = await client.wget<Record<string, unknown>>('');
      const root = String(
        (workspace?.['rootPath'] as string | undefined) ??
        ((workspace?.['workspace'] as Record<string, unknown> | undefined)?.['rootPath'] as string | undefined) ?? '',
      );
      const fallback = FALLBACK[id];
      const envName = descriptor.configHomeEnv ?? fallback?.env ?? 'XDG_CONFIG_HOME';
      const configHome = root ? join(resolveWorkspaceStateDir(root).stateDir, 'runtimes', id) : '';
      const command_ = descriptor.login?.command ?? fallback?.command[0] ?? id;
      const args = descriptor.login?.args ?? fallback?.command.slice(1) ?? [];
      const instructions = descriptor.login?.instructions ?? fallback?.instructions ?? [];

      const plan = { runtime: id, configHome, env: { [envName]: configHome, ...(descriptor.login?.env ?? {}) }, command: command_, args, instructions };

      if (opts['print'] === true || !configHome) {
        emit(plan, () => {
          fields([['runtime', id], ['config home', configHome || style.warn('unknown — is this workspace local to the daemon?')], ['env', `${envName}=${configHome}`], ['command', [command_, ...args].join(' ')]]);
          for (const line of instructions) write(style.dim(`  ${line}`));
        });
        return;
      }

      if (client.isAgent) throw new ApiError('forbidden', 'runtime login is a human, daemon-host operation', 403);

      emit(plan, () => {
        fields([['runtime', id], ['config home', configHome], ['command', [command_, ...args].join(' ')]]);
        for (const line of instructions) write(style.dim(`  ${line}`));
        write('');
      });

      const exitCode = await new Promise<number>((resolveExit) => {
        const child = spawn(command_, args, {
          stdio: 'inherit',
          env: { ...process.env, [envName]: configHome, ...(descriptor.login?.env ?? {}) },
        });
        child.on('error', (error) => {
          write(style.bad(`cannot run ${command_}: ${error.message}`));
          resolveExit(127);
        });
        child.on('exit', (code) => resolveExit(code ?? 0));
      });
      if (exitCode !== 0) process.exitCode = exitCode;
    }));
}
