/** `conductor presentation set|open|reconcile|status` and `conductor presenter` (PLAN §14b, §20). */
import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { ApiError } from '../api.js';
import { emit, fields, style, table, write } from '../output.js';
import { items, run, session } from './util.js';

/** `workers.surface` → nested `{ workers: { surface: value } }`. */
function setPath(target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) throw new ApiError('validation', 'expected a dotted path like workers.surface', 400);
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    node[part] = next && typeof next === 'object' && !Array.isArray(next) ? next : {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
  return target;
}

function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

export function register(program: Command): void {
  const presentation = program.command('presentation').description('where agents are shown (surfaces)');

  presentation
    .command('status', { isDefault: true })
    .description('desired presentation and what the presenters report')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const config = await client.wget<Record<string, unknown>>('/presentation');
      const desired = await client.wget<Record<string, unknown>>('/presenter/desired').catch(() => ({} as Record<string, unknown>));
      emit({ presentation: config, desired }, () => {
        fields([
          ['default', String(config?.['default'] ?? 'headless')],
          ['conductor', JSON.stringify(config?.['weaver'] ?? {})],
          ['workers', JSON.stringify(config?.['workers'] ?? {})],
        ]);
        const workers = items<Record<string, unknown>>(desired['workers']);
        if (workers.length) {
          write('');
          table(workers, [
            { header: 'AGENT', get: (w) => String(w['agentId'] ?? w['id'] ?? '') },
            { header: 'NAME', get: (w) => String(w['name'] ?? '') },
            { header: 'PROJECT', get: (w) => String(w['projectId'] ?? '') },
            { header: 'STATUS', get: (w) => String(w['status'] ?? '') },
          ]);
        }
      });
    }));

  presentation
    .command('set')
    .argument('<path>', 'dotted path, e.g. workers.surface')
    .argument('<value>')
    .description('change the desired presentation config')
    .action(async (path: string, value: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const current = await client.wget<Record<string, unknown>>('/presentation').catch(() => ({} as Record<string, unknown>));
      const next = setPath({ ...(current ?? {}) }, path, coerce(value));
      const saved = await client.put(client.w('/presentation'), next);
      emit(saved ?? next, () => write(`${style.ok('set')} ${path} = ${value}`));
    }));

  presentation
    .command('reconcile')
    .description('ask the presenters to re-create the windows they should own')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.wpost('/presentation/reconcile', {});
      emit(result ?? { ok: true }, () => write(style.ok('reconcile requested')));
    }));

  presentation
    .command('open')
    .description('attach this terminal to the surface session (tmux) or print how to')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const config = await client.wget<Record<string, unknown>>('/presentation').catch(() => ({} as Record<string, unknown>));
      const workers = (config?.['workers'] ?? {}) as Record<string, unknown>;
      const surface = String(workers['surface'] ?? config?.['default'] ?? 'headless');
      const sessionName = String(workers['session'] ?? `ac-${client.workspace ?? 'workspace'}`);
      if (surface !== 'tmux') {
        emit({ surface, attach: null }, () => {
          write(`surface is ${style.bold(surface)} — its windows are managed by \`conductor presenter\` on the machine you are looking at.`);
          write(style.dim('run `conductor presenter` there, or switch with `conductor presentation set workers.surface tmux`'));
        });
        return;
      }
      emit({ surface, attach: `tmux attach -t ${sessionName}` }, () => write(style.dim(`attaching to tmux session ${sessionName}`)));
      const child = spawn('tmux', ['attach', '-t', sessionName], { stdio: 'inherit' });
      await new Promise<void>((resolve) => child.on('exit', () => resolve()));
    }));

  program
    .command('presenter')
    .description('client-side window manager for surfaces (runs on the machine you are looking at)')
    .option('--surface <surface>', 'override the workspace surface for this presenter')
    .option('--once', 'reconcile once and exit')
    .action(async (opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const specifier = '@agent-conductor/presenter';
      let mod: { startPresenter?: (input: Record<string, unknown>) => Promise<unknown> };
      try {
        mod = (await import(specifier)) as { startPresenter?: (input: Record<string, unknown>) => Promise<unknown> };
      } catch (cause) {
        throw new ApiError('not_found', `the presenter is not installed: install @agent-conductor/presenter (${(cause as Error).message})`, 404, {
          hint: 'pnpm add -g @agent-conductor/presenter, or run it from a source checkout',
        });
      }
      if (typeof mod.startPresenter !== 'function') {
        throw new ApiError('internal', '@agent-conductor/presenter does not export startPresenter', 500);
      }
      await mod.startPresenter({
        client,
        apiUrl: client.baseUrl,
        token: client.token ?? '',
        ocCommand: [process.execPath, process.argv[1] ?? 'conductor'],
        workspaceId: client.workspace,
        surface: typeof opts['surface'] === 'string' ? opts['surface'] : undefined,
        once: opts['once'] === true,
        options: { once: opts['once'] === true },
        log: (level: string, msg: string, data?: Record<string, unknown>) => { if (level !== 'debug') process.stderr.write(`[presenter] ${msg}${data ? ' ' + JSON.stringify(data) : ''}\n`); },
      });
    }));
}
