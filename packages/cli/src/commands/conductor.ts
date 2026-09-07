/** `conductor conductor show|reset-session` (PLAN §10, §20). The runtime and the model are the
 * workspace's two model settings — `conductor models` (VS-77), not a conductor-only knob. */
import type { Command } from 'commander';
import type { Agent } from '@agent-conductor/shared';
import { workerToCard } from '@agent-conductor/render';
import { emit, fields, style, write } from '../output.js';
import { run, session, unwrap } from './util.js';

export function register(program: Command): void {
  const conductor = program.command('conductor').description('the conductor agent');

  conductor
    .command('show', { isDefault: true })
    .description('conductor status and the runtime it is on')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget<unknown>('/conductor');
      const agent = unwrap<Agent>(payload, 'agent', 'worker');
      const card = workerToCard(agent, {});
      emit(payload, () => {
        fields([
          ['conductor', `${card.glyph} ${card.name}`],
          ['id', card.id],
          ['runtime', card.runtime],
          ['status', card.statusLabel],
          ['turns', String(card.turn)],
          ['home', String(agent.homePath ?? '')],
        ]);
      });
    }));

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
