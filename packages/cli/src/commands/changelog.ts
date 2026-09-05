/**
 * `conductor changelog` — the human-facing record of what happened (PLAN §13.6), for a project or the
 * whole workspace, over a range of dates.
 *
 * Read-only, like the record itself: there is no subcommand that writes, because there is no route to
 * write with. The summary printed here is the one the daemon rendered, so it is the same line the web
 * app shows for the same entry.
 */
import type { Command } from 'commander';
import { OcError, type ChangelogEntry, type ChangelogPage } from '@agent-conductor/shared';
import { emit, style, table, write } from '../output.js';
import { run, session } from './util.js';

/** The range printed when none is asked for, in days. Long enough to cover a sprint, short enough to read. */
const DEFAULT_DAYS = 30;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 200;

/** The machine's own timezone, so asking for a day prints the entries of that day as the reader counts it. */
function localTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}

function today(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function requireDay(value: string, flag: string): string {
  if (!DAY_RE.test(value)) throw new OcError('validation', `--${flag} must be a date as YYYY-MM-DD, not "${value}"`);
  return value;
}

/** The day an entry falls on, in the machine's timezone — the same bucketing the range is expressed in. */
function dayOf(at: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

export function register(program: Command): void {
  program
    .command('changelog')
    .description('what happened, for a project or the whole workspace')
    .option('--project <id>', 'one project; omitted, the whole workspace')
    .option('--from <date>', 'first day to print (YYYY-MM-DD)')
    .option('--to <date>', 'last day to print (YYYY-MM-DD)')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const timezone = localTimezone();

      const to = opts['to'] ? requireDay(opts['to'], 'to') : today(timezone);
      const from = opts['from'] ? requireDay(opts['from'], 'from') : addDays(to, -(DEFAULT_DAYS - 1));
      if (from > to) throw new OcError('validation', `the range starts after it ends: ${from} to ${to}`);
      const defaulted = !opts['from'] && !opts['to'];

      // Page until the range is covered: `before` walks backwards, so stop once a page is older than
      // `from`, and drop anything newer than `to` on the way.
      const entries: ChangelogEntry[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 100; guard += 1) {
        const page: ChangelogPage = await client.wget<ChangelogPage>('/changelog', {
          ...(opts['project'] ? { project: opts['project'] } : {}),
          limit: String(PAGE),
          ...(cursor ? { before: cursor } : {}),
        });
        const got = page.entries ?? [];
        for (const e of got) {
          const day = dayOf(e.at, timezone);
          if (day > to) continue;
          if (day < from) continue;
          entries.push(e);
        }
        const oldest = got[got.length - 1];
        if (!page.nextCursor || !oldest || dayOf(oldest.at, timezone) < from) break;
        cursor = page.nextCursor;
      }

      emit({ from, to, timezone, project: opts['project'] ?? null, entries }, () => {
        write(style.dim(`${from} → ${to}${defaulted ? ` (the last ${DEFAULT_DAYS} days)` : ''} · ${timezone}`));
        table(entries, [
          { header: 'WHEN', get: (e) => e.at.replace('T', ' ').slice(0, 16) },
          { header: 'KIND', get: (e) => e.kind },
          { header: 'TICKET', get: (e) => e.ticketIdentifier ?? '' },
          { header: 'WHAT', get: (e) => e.summary },
          { header: 'WHO', get: (e) => e.actor.label },
        ], { empty: 'nothing happened in this range' });
      });
    }));
}
