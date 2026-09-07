/**
 * `conductor models [show] | models set conductor|workers` — the whole of model selection (VS-77,
 * ADR 0011). A workspace has exactly two settings; nothing else in the CLI sets a runtime or a model.
 */
import type { Command } from 'commander';
import { emit, fields, style, write } from '../output.js';
import { run, session } from './util.js';

interface ModelSetting { runtime?: string; model?: string | null; effort?: string }
interface WorkspaceModels { conductor?: ModelSetting; workers?: ModelSetting }

const KINDS = ['conductor', 'workers'] as const;
type Kind = (typeof KINDS)[number];

function describe(s: ModelSetting | undefined): string {
  const parts = [s?.runtime ?? '(unset)', s?.model ?? '(runtime default)'];
  if (s?.effort) parts.push(`effort ${s.effort}`);
  return parts.join(' · ');
}

export function register(program: Command): void {
  const models = program.command('models').description('the workspace runtime and model, for the conductor and for its workers');

  models
    .command('show', { isDefault: true })
    .description('show both model settings')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const current = await client.wget<WorkspaceModels>('/models');
      emit(current, () => {
        fields([
          ['conductor', describe(current.conductor)],
          ['workers', describe(current.workers)],
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
      if (!opts['runtime'] && opts['model'] === undefined && opts['effort'] === undefined) {
        throw new Error('nothing to change: pass --runtime, --model or --effort');
      }
      const { client } = await session(command);
      // The whole block is sent back: `PUT /models` parses and stores it entire, so a partial body
      // would drop the setting this command is not changing.
      const current = await client.wget<WorkspaceModels>('/models');
      const next: ModelSetting = { ...(current[kind] ?? {}) };
      if (opts['runtime']) next.runtime = opts['runtime'];
      if (opts['model'] !== undefined) next.model = opts['model'] === 'default' ? null : opts['model'];
      if (opts['effort'] !== undefined) {
        if (opts['effort'] === 'default') delete next.effort;
        else next.effort = opts['effort'];
      }
      const result = await client.put<WorkspaceModels>(client.w('/models'), { ...current, [kind]: next });
      emit(result, () => write(`${style.ok('updated')} ${kind} = ${describe(result[kind])}`));
    }));
}
