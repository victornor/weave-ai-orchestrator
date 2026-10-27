/** `weave worker list|show|pause|resume|relaunch|cancel|purge` (PLAN §11, §20). */
import type { Command } from 'commander';
import type { Agent } from '@weave-ai/shared';
import { workerToCard } from '@weave-ai/render';
import { emit, fields, heading, style, table, write, writeErr } from '../output.js';
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
          { header: 'TURN', get: (r) => String(r.turn), align: 'right' },
          { header: 'STATUS', get: (r) => r.statusLabel },
          { header: 'REASON', get: (r) => r.pauseReason ?? '' },
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
          ['runtime', card.runtime],
          ['status', card.statusLabel],
          ['paused', card.pauseReason ?? undefined],
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
        tool: 'weave_worker_message', input: { workerId: id, body: text },
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
        tool: 'weave_worker_relaunch', input: { workerId: id, note: opts['note'] ?? '' },
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
        tool: 'weave_worker_cancel', input: { workerId: id, reason: opts['reason'] ?? '' },
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

  worker
    .command('prune-homes')
    .description("reclaim home directories and worktrees of finished workers whose work has landed (VS-859)")
    .option('--dry-run', 'list what would be reclaimed and delete nothing')
    .action(async (opts: Record<string, boolean>, command: Command) => run(async () => {
      const dryRun = opts['dryRun'] === true;
      const { client } = await session(command);
      const r = await client.wpost<PruneHomesResult>('/workers/prune-homes', { dryRun });
      emit(r, () => {
        table(r.candidates, [
          { header: 'WORKER', get: (w) => w.workerId },
          { header: 'NAME', get: (w) => w.name },
          { header: 'STATUS', get: (w) => w.status },
          { header: 'TICKET', get: (w) => w.ticket ?? '' },
          { header: 'BRANCH', get: (w) => w.branch ?? '' },
          { header: 'WORKTREE', get: (w) => (w.hasWorktree ? 'yes' : 'gone') },
        ], { empty: 'no finished worker home to reclaim' });
        if (r.skipped.length) {
          write(style.dim(`${r.skipped.length} kept:`));
          table(r.skipped, [
            { header: 'WORKER', get: (s) => s.workerId ?? s.directory },
            { header: 'STATUS', get: (s) => s.status ?? '' },
            { header: 'REASON', get: (s) => s.reason },
            { header: 'DETAIL', get: (s) => s.detail },
          ]);
        }
        for (const f of r.failed) writeErr(`${f.workerId}: ${f.error}`);
        if (dryRun) write(style.dim(`${r.candidates.length} home(s) would be reclaimed; ${r.skipped.length} kept. Re-run without --dry-run to reclaim.`));
        else write(`${style.ok('reclaimed')} ${r.reclaimed.length} home(s); ${r.skipped.length} kept; ${r.failed.length} failed`);
      });
    }));

  worker
    .command('handover')
    .argument('<id>')
    .description("take a worker's session for your own terminal (VS-249)")
    .action(async (id: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.wpost<HandoverCommandResult>(`/workers/${encodeURIComponent(id)}/handover`, {});
      emit(result, () => {
        if (!result.resumable) { write(style.bad(result.reason ?? 'this worker cannot resume a session outside the daemon')); return; }
        if (result.landingLine) write(style.dim(result.landingLine));
        write(result.command ?? '');
      });
    }));

  worker
    .command('handback')
    .argument('<id>')
    .requiredOption('--note <note>', 'what you did while you held the session')
    .description('give a held session back')
    .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.wpost(`/workers/${encodeURIComponent(id)}/handback`, { note: opts['note'] });
      emit(result, () => write(`${style.ok('given back')} ${id}`));
    }));
}

interface HandoverCommandResult { resumable: boolean; command: string | null; runtime: string; landingLine: string | null; reason: string | null }

interface PruneHomesResult {
  dryRun: boolean;
  candidates: Array<{ workerId: string; name: string; status: string; ticket: string | null; branch: string | null; hasWorktree: boolean }>;
  reclaimed: Array<{ workerId: string }>;
  skipped: Array<{ workerId: string | null; directory: string; status: string | null; reason: string; detail: string }>;
  failed: Array<{ workerId: string; error: string }>;
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
