/** `weave routine list|show|add|pause|resume|rm` — scheduled tasks (VS-220). */
import type { Command } from 'commander';
import { OcError, type Routine } from '@weave-ai/shared';
import { emit, fields, table } from '../output.js';
import { items, run, session, unwrap } from './util.js';

function parseDaily(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new OcError('validation', `--daily must be HH:MM, not "${value}"`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new OcError('validation', `--daily must be HH:MM, not "${value}"`);
  return { hour, minute };
}

function scheduleLabel(r: Routine): string {
  const t = r.trigger;
  const tz = t.timezone;
  if ('daily' in t) {
    const hh = String(t.daily.hour).padStart(2, '0');
    const mm = String(t.daily.minute).padStart(2, '0');
    return `daily ${hh}:${mm} ${tz}`;
  }
  return `every ${t.everyMinutes}m ${tz}`;
}

export function register(program: Command): void {
  const routine = program.command('routine').description('scheduled tasks (recurring conductor alarms)');

  routine
    .command('list', { isDefault: true })
    .description('list scheduled tasks')
    .action(async (_opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget('/routines');
      const rows = items<Routine>(payload);
      emit(payload, () => {
        table(rows, [
          { header: 'ID', get: (r) => r.id },
          { header: 'NAME', get: (r) => r.name },
          { header: 'WHEN', get: (r) => scheduleLabel(r) },
          { header: 'STATUS', get: (r) => r.status },
          { header: 'NEXT', get: (r) => r.nextFireAt ?? '' },
          { header: 'ACTION', get: (r) => r.template.action },
        ], { empty: 'no scheduled tasks yet' });
      });
    }));

  routine
    .command('show')
    .argument('<id>')
    .description('show one scheduled task')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const row = unwrap<Routine>(await client.wget(`/routines/${encodeURIComponent(id)}`));
      emit(row, () => {
        fields([
          ['id', row.id],
          ['name', row.name],
          ['status', row.status],
          ['when', scheduleLabel(row)],
          ['next', row.nextFireAt ?? ''],
          ['last', row.lastFiredAt ?? 'never'],
          ['action', row.template.action],
          ['instruction', row.template.instruction],
        ]);
      });
    }));

  routine
    .command('add')
    .requiredOption('--name <name>')
    .option('--daily <HH:MM>', 'wall-clock time in --tz')
    .option('--every <minutes>', 'interval in minutes (≥ 15)')
    .option('--tz <iana>', 'IANA timezone (defaults to the host zone)')
    .requiredOption('--instruction <text>')
    .option('--action <action>', 'report (default) or file_work')
    .option('--max-tickets <n>')
    .option('--project <id>')
    .description('add a scheduled task')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      if (opts['daily'] && opts['every']) throw new OcError('validation', 'pass --daily or --every, not both');
      if (!opts['daily'] && !opts['every']) throw new OcError('validation', 'pass --daily HH:MM or --every <minutes>');
      const trigger: Record<string, unknown> = { kind: 'schedule' };
      if (opts['tz']) trigger['timezone'] = opts['tz'];
      if (opts['daily']) trigger['daily'] = parseDaily(opts['daily']);
      if (opts['every']) trigger['everyMinutes'] = Number(opts['every']);
      const body: Record<string, unknown> = {
        name: opts['name'],
        trigger,
        instruction: opts['instruction'],
      };
      if (opts['action']) body['action'] = opts['action'];
      if (opts['maxTickets']) body['maxTicketsPerFire'] = Number(opts['maxTickets']);
      if (opts['project']) body['projectId'] = opts['project'];
      const { client } = await session(command);
      const row = await client.wpost<Routine>('/routines', body);
      emit(row, () => {
        fields([
          ['id', row.id],
          ['name', row.name],
          ['status', row.status],
          ['when', scheduleLabel(row)],
          ['next', row.nextFireAt ?? ''],
        ]);
      });
    }));

  routine
    .command('pause')
    .argument('<id>')
    .description('pause a scheduled task')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const row = await client.patch<Routine>(client.w(`/routines/${encodeURIComponent(id)}`), { status: 'paused' });
      emit(row, () => { fields([['id', row.id], ['name', row.name], ['status', row.status]]); });
    }));

  routine
    .command('resume')
    .argument('<id>')
    .description('resume a scheduled task')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const row = await client.patch<Routine>(client.w(`/routines/${encodeURIComponent(id)}`), { status: 'active' });
      emit(row, () => { fields([['id', row.id], ['name', row.name], ['status', row.status], ['next', row.nextFireAt ?? '']]); });
    }));

  routine
    .command('rm')
    .argument('<id>')
    .description('remove a scheduled task')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.del(client.w(`/routines/${encodeURIComponent(id)}`));
      emit(result, () => { fields([['removed', id]]); });
    }));
}
