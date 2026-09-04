/** `oc conductor show|set-model|set-runtime|reset-session` (PLAN §10, §20). */
import type { Command } from 'commander';
import type { Agent } from '@openconductor/shared';
import { workerToCard } from '@openconductor/render';
import { emit, fields, style, write } from '../output.js';
import { run, session, unwrap } from './util.js';

export function register(program: Command): void {
  const conductor = program.command('conductor').description('the conductor agent');

  conductor
    .command('show', { isDefault: true })
    .description('conductor status, runtime and model')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget<unknown>('/conductor');
      const agent = unwrap<Agent>(payload, 'agent');
      const card = workerToCard(agent, {});
      emit(payload, () => {
        fields([
          ['conductor', `${card.glyph} ${card.name}`],
          ['id', card.id],
          ['runtime', card.runtime],
          ['model', card.model ?? '(runtime default)'],
          ['status', card.statusLabel],
          ['turns', String(card.turn)],
          ['home', String(agent.homePath ?? '')],
        ]);
      });
    }));

  for (const [name, field] of [['set-runtime', 'runtime'], ['set-model', 'model']] as const) {
    conductor
      .command(name)
      .argument('<value>', field === 'model' ? 'model id, or "default"' : 'runtime id')
      .description(`change the conductor ${field}`)
      .action(async (value: string, _opts: unknown, command: Command) => run(async () => {
        const { client } = await session(command);
        const result = await client.patch(client.w('/conductor'), { [field]: field === 'model' && value === 'default' ? null : value });
        emit(result, () => write(`${style.ok('updated')} conductor ${field} = ${value}`));
      }));
  }

  conductor
    .command('reset-session')
    .option('--reason <reason>', 'why', 'reset from the CLI')
    .description('start the conductor on a fresh session (context is rebuilt from the KB)')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.wpost('/conductor/reset-session', { reason: opts['reason'] ?? '' });
      emit(result ?? { ok: true }, () => write(style.ok('conductor session reset')));
    }));
}
