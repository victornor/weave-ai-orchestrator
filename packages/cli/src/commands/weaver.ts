/** `weave weaver show|reset-session` (PLAN §10, §20). The runtime and the model are the
 * workspace's two model settings — `weave models` (VS-77), not a weaver-only knob. */
import type { Command } from 'commander';
import type { Agent } from '@weave-ai/shared';
import { workerToCard } from '@weave-ai/render';
import { emit, fields, style, write } from '../output.js';
import { run, session, unwrap } from './util.js';

export function register(program: Command): void {
  const weaver = program.command('weaver').description('the weaver agent');

  weaver
    .command('show', { isDefault: true })
    .description('weaver status and the runtime it is on')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget<unknown>('/weaver');
      const agent = unwrap<Agent>(payload, 'agent', 'worker');
      const card = workerToCard(agent, {});
      emit(payload, () => {
        fields([
          ['weaver', `${card.glyph} ${card.name}`],
          ['id', card.id],
          ['runtime', card.runtime],
          ['status', card.statusLabel],
          ['turns', String(card.turn)],
          ['home', String(agent.homePath ?? '')],
        ]);
      });
    }));

  weaver
    .command('reset-session')
    .option('--reason <reason>', 'why', 'reset from the CLI')
    .description('start the weaver on a fresh session (context is rebuilt from the KB)')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.wpost('/weaver/reset-session', { reason: opts['reason'] ?? '' });
      emit(result ?? { ok: true }, () => write(style.ok('weaver session reset')));
    }));
}
