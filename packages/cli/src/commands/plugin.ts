/** `weave plugin purge-data <pluginId>` — the operator-only scoped delete (VS-334, design.md Decision 3). */
import type { Command } from 'commander';
import { emit, fields, style, write } from '../output.js';
import { run, session } from './util.js';

export function register(program: Command): void {
  const plugin = program.command('plugin').description('plugin management');

  plugin
    .command('purge-data')
    .argument('<pluginId>')
    .description("remove one plugin's stored data from this workspace (operator only)")
    .action(async (pluginId: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.del<{ pluginId: string; removed: number }>(client.w(`/plugin-data/${encodeURIComponent(pluginId)}`));
      emit(payload, () => {
        fields([['plugin', payload.pluginId], ['rows removed', String(payload.removed)]]);
        if (payload.removed === 0) write(style.dim('no stored data for this plugin id'));
      });
    }));
}
