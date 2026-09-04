/** `conductor worker list|show|pause|resume|relaunch|cancel|purge` (PLAN §11, §20). */
import type { Command } from 'commander';
import type { Agent } from '@agent-conductor/shared';
import { workerToCard } from '@agent-conductor/render';
import { emit, fields, heading, style, table, write } from '../output.js';
import { items, run, session } from './util.js';

interface WorkerDetail { agent?: Agent; session?: Record<string, unknown>; ticket?: Record<string, unknown>; lastRun?: Record<string, unknown>; usage?: Record<string, unknown> }

export function register(program: Command): void {
  const worker = program.command('worker').description('live workers');

  worker
    .command('list', { isDefault: true })
    .description('list workers')
    .option('-p, --project <id>')
    .option('-r, --role <id>')
    .option('-s, --status <status>', 'comma-separated agent statuses')
    .option('--all', 'include retired workers')
    .action(async (opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget('/workers', {
        project: typeof opts['project'] === 'string' ? opts['project'] : undefined,
        role: typeof opts['role'] === 'string' ? opts['role'] : undefined,
        status: typeof opts['status'] === 'string' ? opts['status'] : undefined,
        includeRetired: opts['all'] === true ? 'true' : undefined,
      });
      const rows = items<Agent>(payload, 'workers').map((a) => workerToCard(a, {}));
      emit(payload, () => {
        table(rows, [
          { header: '', get: (r) => r.glyph },
          { header: 'ID', get: (r) => r.id },
          { header: 'NAME', get: (r) => r.name },
          { header: 'PROJECT', get: (r) => r.project ?? '' },
          { header: 'TICKET', get: (r) => r.ticket?.identifier ?? '' },
          { header: 'RUNTIME', get: (r) => r.runtime },
          { header: 'MODEL', get: (r) => r.model ?? '(default)' },
          { header: 'TURN', get: (r) => String(r.turn), align: 'right' },
          { header: 'STATUS', get: (r) => r.statusLabel },
        ], { empty: 'no workers running' });
      });
    }));

  worker
    .command('show')
    .argument('<id>')
    .description('worker detail: session, ticket, last run and spend')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget<WorkerDetail>(`/workers/${encodeURIComponent(id)}`);
      const agent = (payload.agent ?? payload) as Agent;
      const ticket = payload.ticket ?? null;
      const usage = payload.usage ?? {};
      const card = workerToCard(agent, {
        ticket: ticket ? { id: String(ticket['id'] ?? ''), identifier: String(ticket['identifier'] ?? ''), title: String(ticket['title'] ?? '') } : null,
        usage: { tokens: numberOr(usage['tokens'] ?? sumTokens(usage), null), costCents: numberOr(usage['costCents'], null) },
      });
      emit(payload, () => {
        fields([
          ['worker', `${card.glyph} ${card.name}`],
          ['id', card.id],
          ['role', card.role ?? ''],
          ['project', card.project ?? ''],
          ['ticket', card.ticket ? `${card.ticket.identifier} — ${card.ticket.title}` : ''],
          ['runtime', `${card.runtime}${card.model ? ` · ${card.model}` : ''}`],
          ['status', card.statusLabel],
          ['turn', String(card.turn)],
          ['home', String(agent.homePath ?? '')],
          ['worktree', String(agent.worktreePath ?? '')],
          ['branch', String(agent.branch ?? '')],
          ['tokens', card.tokens ?? ''],
          ['cost', card.cost ?? ''],
          ['error', agent.errorText ? style.bad(String(agent.errorText)) : undefined],
        ]);
        const lastRun = payload.lastRun;
        if (lastRun) {
          write('');
          heading('Last run');
          fields([
            ['run', String(lastRun['id'] ?? '')],
            ['status', String(lastRun['status'] ?? '')],
            ['started', String(lastRun['startedAt'] ?? '')],
            ['summary', String(lastRun['summary'] ?? '')],
          ]);
        }
      });
    }));

  worker
    .command('brief')
    .argument('<id>')
    .description('print the rendered brief the worker was given')
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget<unknown>(`/workers/${encodeURIComponent(id)}/brief`);
      const text = typeof payload === 'string' ? payload : String((payload as Record<string, unknown>)?.['brief'] ?? '');
      emit({ id, brief: text }, () => write(text || style.dim('(no brief)')));
    }));

  worker
    .command('message')
    .argument('<id>')
    .argument('<body...>')
    .description('send a direct message to a worker (wakes it)')
    .action(async (id: string, body: string[], _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const text = body.join(' ');
      const result = await client.write({
        tool: 'ac_worker_message', input: { workerId: id, body: text },
        http: { method: 'POST', path: client.w(`/workers/${encodeURIComponent(id)}/message`), body: { body: text } },
      });
      emit(result, () => write(`${style.ok('queued')} message for ${id}`));
    }));

  for (const verb of ['pause', 'resume'] as const) {
    worker
      .command(verb)
      .argument('<id>')
      .option('--reason <reason>', 'why', `${verb}d from the CLI`)
      .description(`${verb} a worker`)
      .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
        const { client } = await session(command);
        const result = await client.wpost(`/workers/${encodeURIComponent(id)}/${verb}`, { reason: opts['reason'] ?? '' });
        emit(result, () => write(`${style.ok(`${verb}d`)} ${id}`));
      }));
  }

  worker
    .command('relaunch')
    .argument('<id>')
    .option('--note <note>', 'note carried into the new session', 'relaunched from the CLI')
    .description('relaunch a stuck worker with a fresh session')
    .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.write({
        tool: 'ac_worker_relaunch', input: { workerId: id, note: opts['note'] ?? '' },
        http: { method: 'POST', path: client.w(`/workers/${encodeURIComponent(id)}/relaunch`), body: { note: opts['note'] ?? '' } },
      });
      emit(result, () => write(`${style.ok('relaunched')} ${id}`));
    }));

  worker
    .command('cancel')
    .argument('<id>')
    .option('--reason <reason>', 'why', 'cancelled from the CLI')
    .description("cancel a worker's current run")
    .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.write({
        tool: 'ac_worker_cancel', input: { workerId: id, reason: opts['reason'] ?? '' },
        http: { method: 'POST', path: client.w(`/workers/${encodeURIComponent(id)}/cancel`), body: { reason: opts['reason'] ?? '' } },
      });
      emit(result, () => write(`${style.ok('cancelled')} ${id}`));
    }));

  worker
    .command('purge')
    .argument('<id>')
    .option('--force', 'purge even when the worktree is dirty')
    .description('retire a worker and remove its home and worktree')
    .action(async (id: string, opts: Record<string, boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.wpost(`/workers/${encodeURIComponent(id)}/purge`, { force: opts['force'] === true });
      emit(result, () => write(`${style.ok('purged')} ${id}`));
    }));
}

function numberOr(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sumTokens(usage: Record<string, unknown>): number | null {
  const input = numberOr(usage['inputTokens'] ?? usage['tokensIn'], null);
  const output = numberOr(usage['outputTokens'] ?? usage['tokensOut'], null);
  if (input === null && output === null) return null;
  return (input ?? 0) + (output ?? 0);
}
