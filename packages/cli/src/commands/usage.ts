/** `conductor usage` — tokens are the headline, cost is labelled reported or estimated (PLAN §16.3). */
import type { Command } from 'commander';
import { USAGE_GRAINS, USAGE_WINDOWS } from '@agent-conductor/shared';
import { accountLimits, mixedBillingNote, showCost, usageRows, usageTotals, type UsageSeries } from '@agent-conductor/render';
import { emit, fields, heading, style, table, write } from '../output.js';
import type { AccountSync, RuntimeAccount } from '@agent-conductor/shared';
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
    .option('--sync', 'probe the plan limits now instead of reading the last snapshot')
    .option('--runtime <id>', 'with --sync, probe only this runtime')
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

      // Probe before reading, when asked. The snapshots are then re-read the same way as always,
      // so a sync of one runtime cannot quietly narrow the block to that runtime alone.
      const sync = opts['sync'] === true
        ? await client.wpost<AccountSync>('/usage/accounts/refresh', typeof opts['runtime'] === 'string' ? { runtimeId: opts['runtime'] } : {})
        : null;
      const series = await client.wget<UsageSeries>('/usage', query);
      const accounts = await client.wget<RuntimeAccount[]>('/usage/accounts').catch(() => [] as RuntimeAccount[]);
      const totals = usageTotals(series);
      // Dollars only mean something when some of this window was billed per token; on a
      // subscription the plan windows take their place (PLAN §16.3).
      const withCost = showCost(series?.billingMix);
      const plans = accountLimits(accounts, new Date());
      emit({ ...series, accounts, ...(sync ? { sync } : {}) }, () => {
        heading(`${query.scope} · ${query.window}${series?.range?.grain ? ` · ${series.range.grain}` : ''}`);
        fields([
          ['tokens', `${totals.tokens}  ${style.dim(`in ${totals.tokensIn} · out ${totals.tokensOut} · cached ${totals.tokensCached}`)}`],
          ...(withCost ? [['cost', `${totals.cost}${totals.reportedShare ? style.dim(`  ${totals.reportedShare}`) : ''}`] as [string, string]] : []),
          ['runs', String(totals.runs)],
          ['vs previous', `${totals.tokensDelta} tokens${withCost ? ` · ${totals.costDelta} cost` : ''}`],
        ]);

        for (const plan of plans) {
          write('');
          heading(`${plan.runtimeId} · ${plan.plan} ${style.dim(`synced ${plan.age}`)}`);
          if (plan.limitsAvailable) {
            fields(plan.windows.map((w) => [w.label, `${w.percent}%${w.resetsIn ? style.dim(`  ${w.resetsIn}`) : ''}`] as [string, string]));
          } else {
            write(style.dim(`  ${plan.probeFailed ? 'account probe failed' : 'limits unavailable'}${plan.note ? ` — ${plan.note}` : ''}`));
          }
        }
        // What the sync itself did. A runtime refused as too recent is not an error — it is a wait,
        // and saying so is the whole point of the daemon answering rather than refusing.
        if (sync) {
          write('');
          if (sync.synced.length) write(style.dim(`  synced ${sync.synced.join(', ')}`));
          for (const t of sync.throttled) write(style.dim(`  ${t.runtimeId}: synced too recently — next sync in ${Math.max(1, Math.ceil(t.retryAfterMs / 1000))}s`));
          for (const f of sync.failed) write(style.dim(`  ${f.runtimeId}: sync failed — ${f.message}`));
        }

        const mixed = mixedBillingNote(series?.billingMix);
        if (mixed) { write(''); write(style.dim(`  ${mixed}`)); }
        if (opts['series'] === true) {
          write('');
          table(usageRows(series), [
            { header: 'BUCKET', get: (r) => r.bucket },
            { header: 'TOKENS', get: (r) => r.tokens, align: 'right' },
            { header: 'IN', get: (r) => r.tokensIn, align: 'right' },
            { header: 'OUT', get: (r) => r.tokensOut, align: 'right' },
            ...(withCost ? [{ header: 'COST', get: (r: ReturnType<typeof usageRows>[number]) => r.cost, align: 'right' as const }] : []),
            { header: 'RUNS', get: (r) => String(r.runs), align: 'right' },
          ], { empty: 'no buckets in this window' });
        }
      });
    }));
}
