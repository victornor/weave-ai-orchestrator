/** `oc usage` — tokens are the headline, cost is labelled reported or estimated (PLAN §16.3). */
import type { Command } from 'commander';
import { USAGE_GRAINS, USAGE_WINDOWS } from '@openconductor/shared';
import { usageRows, usageTotals, type UsageSeries } from '@openconductor/render';
import { emit, fields, heading, style, table, write } from '../output.js';
import { run, session } from './util.js';

export function register(program: Command): void {
  program
    .command('usage')
    .description('tokens and cost by scope and window')
    .option('--scope <scope>', 'workspace | project:<id> | role:<id> | worker:<id> | ticket:<id> | model:<id>', 'workspace')
    .option('--window <window>', USAGE_WINDOWS.join('|'), '24h')
    .option('--grain <grain>', USAGE_GRAINS.join('|'))
    .option('--start <iso>', 'custom window start')
    .option('--end <iso>', 'custom window end')
    .option('--by <dimension>', 'break down by model|ticket|role|worker|project')
    .option('--series', 'print every bucket, not only the totals')
    .action(async (opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const query = {
        scope: String(opts['scope'] ?? 'workspace'),
        window: String(opts['window'] ?? '24h'),
        grain: typeof opts['grain'] === 'string' ? opts['grain'] : undefined,
        start: typeof opts['start'] === 'string' ? opts['start'] : undefined,
        end: typeof opts['end'] === 'string' ? opts['end'] : undefined,
      };

      if (typeof opts['by'] === 'string') {
        const payload = await client.wget<unknown>('/usage/top', { ...query, by: opts['by'] });
        const rows = Array.isArray(payload) ? payload as Array<Record<string, unknown>> : [];
        emit(payload, () => {
          table(rows, [
            { header: String(opts['by']).toUpperCase(), get: (r) => String(r['label'] ?? r['key'] ?? '') },
            { header: 'TOKENS', get: (r) => usageTotals({ total: r as never, previous: {} }).tokens, align: 'right' },
            { header: 'COST', get: (r) => usageTotals({ total: r as never, previous: {} }).cost, align: 'right' },
            { header: 'RUNS', get: (r) => String(r['runs'] ?? 0), align: 'right' },
          ], { empty: 'no usage in this window' });
        });
        return;
      }

      const series = await client.wget<UsageSeries>('/usage', query);
      const totals = usageTotals(series);
      emit(series, () => {
        heading(`${query.scope} · ${query.window}${series?.range?.grain ? ` · ${series.range.grain}` : ''}`);
        fields([
          ['tokens', `${totals.tokens}  ${style.dim(`in ${totals.tokensIn} · out ${totals.tokensOut} · cached ${totals.tokensCached}`)}`],
          ['cost', `${totals.cost}${totals.reportedShare ? style.dim(`  ${totals.reportedShare}`) : ''}`],
          ['runs', String(totals.runs)],
          ['vs previous', `${totals.tokensDelta} tokens · ${totals.costDelta} cost`],
        ]);
        if (opts['series'] === true) {
          write('');
          table(usageRows(series), [
            { header: 'BUCKET', get: (r) => r.bucket },
            { header: 'TOKENS', get: (r) => r.tokens, align: 'right' },
            { header: 'IN', get: (r) => r.tokensIn, align: 'right' },
            { header: 'OUT', get: (r) => r.tokensOut, align: 'right' },
            { header: 'COST', get: (r) => r.cost, align: 'right' },
            { header: 'RUNS', get: (r) => String(r.runs), align: 'right' },
          ], { empty: 'no buckets in this window' });
        }
      });
    }));
}
