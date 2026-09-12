/**
 * `conductor models [show] | models set conductor|workers | models options …` — model selection
 * (VS-77, ADR 0011; VS-162, ADR 0012). The CLI's own argument vocabulary (`conductor`/`workers`) is
 * unchanged for now (VS-260's job); the wire field it reads and writes is `weaver` (VS-263) —
 * `wireField()` is the one place that translates between them.
 */
import type { Command } from 'commander';
import { ApiError } from '../api.js';
import { emit, fields, style, write } from '../output.js';
import { run, session } from './util.js';

interface ModelSetting { runtime?: string; model?: string | null; effort?: string }
interface WorkerModelOption extends ModelSetting { id?: string; description?: string }
interface WorkspaceModels {
  weaver?: ModelSetting;
  workers?: ModelSetting;
  workerOptions?: WorkerModelOption[];
  locked?: { weaver?: boolean; workers?: boolean; workerOptions?: boolean };
}

const KINDS = ['conductor', 'workers'] as const;
type Kind = (typeof KINDS)[number];

/** The CLI's own argument spelling ('conductor'/'workers') to the wire field it reads/writes. */
function wireField(kind: Kind): 'weaver' | 'workers' {
  return kind === 'conductor' ? 'weaver' : 'workers';
}

function assertUnlocked(current: WorkspaceModels, control: 'conductor' | 'workers' | 'workerOptions'): void {
  const field = control === 'workerOptions' ? 'workerOptions' : wireField(control);
  if (current.locked?.[field]) {
    throw new ApiError('conflict', `${control} is set on the daemon; use \`conductor daemon models\` to change it`, 409);
  }
}

function describe(s: ModelSetting | undefined): string {
  const parts = [s?.runtime ?? '(unset)', s?.model ?? '(runtime default)'];
  if (s?.effort) parts.push(`effort ${s.effort}`);
  return parts.join(' · ');
}

function describeOption(o: WorkerModelOption): string {
  if (o.runtime == null || o.runtime === '') {
    return `${o.id ?? '?'} — ${o.description ?? ''} (no runtime chosen)`;
  }
  return `${o.id ?? '?'} — ${o.description ?? ''} (${describe(o)})`;
}

export function register(program: Command): void {
  const models = program.command('models').description('the workspace runtime and model, for the conductor and for its workers');

  models
    .command('show', { isDefault: true })
    .description('show both model settings and the worker-options catalog')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const current = await client.wget<WorkspaceModels>('/models');
      emit(current, () => {
        const mark = (control: 'conductor' | 'workers', label: string): string =>
          current.locked?.[wireField(control)] ? `${label} (daemon)` : label;
        fields([
          [mark('conductor', 'conductor'), describe(current.weaver)],
          [mark('workers', 'workers'), describe(current.workers)],
          ...((current.workerOptions ?? []).map((o) => [current.locked?.workerOptions ? 'option (daemon)' : 'option', describeOption(o)] as [string, string])),
        ]);
      });
    }));

  models
    .command('set')
    .argument('<setting>', `which setting to change: ${KINDS.join(' or ')}`)
    .option('--runtime <id>', 'runtime id, as `conductor runtime list` reports it')
    .option('--model <id>', 'model id, or "default" to let the runtime choose')
    .option('--effort <effort>', 'reasoning effort the runtime understands, or "default" to clear it')
    .description('change one of the two model settings')
    .action(async (setting: string, opts: Record<string, string | undefined>, command: Command) => run(async () => {
      if (!KINDS.includes(setting as Kind)) throw new Error(`unknown setting ${setting}: expected ${KINDS.join(' or ')}`);
      const kind = setting as Kind;
      const field = wireField(kind);
      if (!opts['runtime'] && opts['model'] === undefined && opts['effort'] === undefined) {
        throw new Error('nothing to change: pass --runtime, --model or --effort');
      }
      const { client } = await session(command);
      const current = await client.wget<WorkspaceModels>('/models');
      assertUnlocked(current, kind);
      const next: ModelSetting = { ...(current[field] ?? {}) };
      if (opts['runtime']) next.runtime = opts['runtime'];
      if (opts['model'] !== undefined) next.model = opts['model'] === 'default' ? null : opts['model'];
      if (opts['effort'] !== undefined) {
        if (opts['effort'] === 'default') delete next.effort;
        else next.effort = opts['effort'];
      }
      const result = await client.put<WorkspaceModels>(client.w('/models'), { ...current, [field]: next });
      emit(result, () => write(`${style.ok('updated')} ${kind} = ${describe(result[field])}`));
    }));

  const options = models.command('options').description('named worker-model options a ticket may pick (VS-162)');

  options
    .command('add')
    .requiredOption('--id <id>', 'kebab-case id the conductor passes as workerModelId')
    .requiredOption('--description <text>', 'when-to-use note, at most 200 characters')
    .requiredOption('--runtime <id>', 'runtime id')
    .option('--model <id>', 'model id, or "default" to let the runtime choose')
    .option('--effort <effort>', 'reasoning effort, or omit')
    .description('add a worker-model option')
    .action(async (opts: Record<string, string | undefined>, command: Command) => run(async () => {
      const { client } = await session(command);
      const current = await client.wget<WorkspaceModels>('/models');
      assertUnlocked(current, 'workerOptions');
      const option: WorkerModelOption = {
        id: opts['id'],
        description: opts['description'],
        runtime: opts['runtime'],
        model: opts['model'] === undefined || opts['model'] === 'default' ? null : opts['model'],
      };
      if (opts['effort']) option.effort = opts['effort'];
      const workerOptions = [...(current.workerOptions ?? []), option];
      const result = await client.put<WorkspaceModels>(client.w('/models'), { ...current, workerOptions });
      emit(result, () => write(`${style.ok('added')} option ${describeOption(option)}`));
    }));

  options
    .command('set')
    .argument('<id>', 'option id to change')
    .option('--description <text>', 'when-to-use note')
    .option('--runtime <id>', 'runtime id')
    .option('--model <id>', 'model id, or "default" to let the runtime choose')
    .option('--effort <effort>', 'reasoning effort, or "default" to clear it')
    .description('edit a worker-model option')
    .action(async (id: string, opts: Record<string, string | undefined>, command: Command) => run(async () => {
      const { client } = await session(command);
      const current = await client.wget<WorkspaceModels>('/models');
      assertUnlocked(current, 'workerOptions');
      const list = [...(current.workerOptions ?? [])];
      const idx = list.findIndex((o) => o.id === id);
      if (idx < 0) throw new Error(`no worker option '${id}'`);
      const next = { ...list[idx]! };
      if (opts['description'] !== undefined) next.description = opts['description'];
      if (opts['runtime']) next.runtime = opts['runtime'];
      if (opts['model'] !== undefined) next.model = opts['model'] === 'default' ? null : opts['model'];
      if (opts['effort'] !== undefined) {
        if (opts['effort'] === 'default') delete next.effort;
        else next.effort = opts['effort'];
      }
      list[idx] = next;
      const result = await client.put<WorkspaceModels>(client.w('/models'), { ...current, workerOptions: list });
      emit(result, () => write(`${style.ok('updated')} option ${describeOption(next)}`));
    }));

  options
    .command('remove')
    .argument('<id>', 'option id to remove')
    .description('remove a worker-model option')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const current = await client.wget<WorkspaceModels>('/models');
      assertUnlocked(current, 'workerOptions');
      const workerOptions = (current.workerOptions ?? []).filter((o) => o.id !== id);
      if (workerOptions.length === (current.workerOptions ?? []).length) throw new Error(`no worker option '${id}'`);
      const result = await client.put<WorkspaceModels>(client.w('/models'), { ...current, workerOptions });
      emit(result, () => write(`${style.ok('removed')} option ${id}`));
    }));
}
