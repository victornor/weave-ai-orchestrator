/** `weave worker list|show|pause|resume|relaunch|cancel|purge|prune-homes|retained|reclaim` (PLAN §11, §20). */
import type { Command } from 'commander';
import { RETAINED_COPY_CLASSES, type Agent, type RetainedCopiesReport, type RetainedCopy, type RetainedReclaimOffer } from '@weave-ai/shared';
import { formatBytes, workerToCard } from '@weave-ai/render';
import { emit, fields, heading, isJson, style, table, write, writeErr } from '../output.js';
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
    .option('--ignore-age', 'also reclaim homes inside the retention window; the age rule only, every safety gate still applies')
    .action(async (opts: Record<string, boolean>, command: Command) => run(async () => {
      const dryRun = opts['dryRun'] === true;
      const ignoreAge = opts['ignoreAge'] === true;
      const { client } = await session(command);
      const post = (body: { dryRun: boolean; ignoreAge: boolean }): Promise<PruneHomesResult> =>
        client.wpost<PruneHomesResult>('/workers/prune-homes', body);
      let r: PruneHomesResult;
      if (!dryRun && ignoreAge) {
        // Say what the flag widens before anything is deleted: the same pass without it, then with it.
        const [base, wide] = await Promise.all([post({ dryRun: true, ignoreAge: false }), post({ dryRun: true, ignoreAge: true })]);
        const more = wide.candidates.length - base.candidates.length;
        if (!isJson()) write(style.warn(`ignoring the ${wide.windowDays}-day window: ${more} more home(s) become eligible`));
        r = await post({ dryRun: false, ignoreAge: true });
      } else {
        r = await post({ dryRun, ignoreAge });
      }
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
        if (ignoreAge) write(style.dim(`ignoring the ${r.windowDays}-day window`));
        if (dryRun) write(style.dim(`${r.candidates.length} home(s) would be reclaimed; ${r.skipped.length} kept. Re-run without --dry-run to reclaim.`));
        else write(`${style.ok('reclaimed')} ${r.reclaimed.length} home(s); ${r.skipped.length} kept; ${r.failed.length} failed`);
      });
    }));

  worker
    .command('retained')
    .description('worker copies kept because their work has not landed: size, class, age and why (VS-955)')
    .option('--scan', 'rescan first (git state and disk usage of every kept copy) and wait for it')
    .action(async (opts: Record<string, boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      if (opts['scan'] === true) {
        await client.wpost('/workers/retained/scan', {});
        const deadline = Date.now() + 30 * 60_000;
        while ((await client.wget<RetainedCopiesReport>('/workers/retained')).scanning && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, RETAINED_POLL_MS));
        }
      }
      const r = await client.wget<RetainedCopiesReport>('/workers/retained');
      emit(r, () => {
        if (r.disk) {
          const pct = r.disk.totalBytes ? Math.round((r.disk.freeBytes / r.disk.totalBytes) * 100) : 0;
          const line = `${r.disk.path}: ${formatBytes(r.disk.freeBytes)} free of ${formatBytes(r.disk.totalBytes)} (${pct}%)`;
          write(r.disk.low ? style.warn(`${line} — below the warning threshold`) : style.dim(line));
        }
        table(r.copies, [
          { header: 'SIZE', get: (c) => formatBytes(c.bytes), align: 'right' },
          { header: 'DIRECTORY', get: (c) => c.directory },
          { header: 'TICKET', get: (c) => c.ticketIdentifier ?? '' },
          { header: 'STATUS', get: (c) => c.ticketStatus ?? '' },
          { header: 'CLASS', get: (c) => `${c.class}${c.offerable ? ' *' : ''}` },
          { header: 'AGE', get: (c) => ageDays(c), align: 'right' },
          { header: 'WHY KEPT', get: (c) => whyKept(c) },
          { header: 'APPROVAL', get: (c) => (c.needsOwnApproval ? 'own card' : 'shared') },
        ], { empty: r.scannedAt ? 'no retained worker copies' : 'not scanned yet — run with --scan' });
        write(style.dim(`${r.totals.count} retained ${r.totals.count === 1 ? 'copy' : 'copies'}, ${formatBytes(r.totals.bytes)}; ${r.totals.offerable.count} offerable (*, terminal ≥ ${r.offerDays} days), ${formatBytes(r.totals.offerable.bytes)}. Scanned ${r.scannedAt ?? 'never'}${r.scanning ? ' (a scan is running)' : ''}.`));
        if (r.totals.offerable.count) write(style.dim('Offer a reclaim with `weave worker reclaim --offerable`; nothing is removed until you approve its card.'));
      });
    }));

  worker
    .command('reclaim [directories...]')
    .description('offer a reclaim of retained worker copies: raises discard-approval cards, removes nothing (VS-955)')
    .option('--class <class>', `only copies of this class (${RETAINED_COPY_CLASSES.filter((c) => c !== 'open').join(', ')})`)
    .option('--offerable', 'only copies whose ticket has been terminal for the offer window')
    .action(async (directories: string[], opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      let selected = directories;
      const cls = typeof opts['class'] === 'string' ? opts['class'] : undefined;
      if (cls !== undefined && !(RETAINED_COPY_CLASSES as readonly string[]).includes(cls)) throw new Error(`unknown class "${cls}"`);
      if (cls !== undefined || opts['offerable'] === true) {
        const r = await client.wget<RetainedCopiesReport>('/workers/retained');
        const pool = r.copies.filter((c) => (cls === undefined || c.class === cls) && (opts['offerable'] !== true || c.offerable));
        selected = [...new Set([...selected, ...pool.map((c) => c.directory)])];
      }
      if (selected.length === 0) throw new Error('name the copies to reclaim, or use --class / --offerable (see `weave worker retained`)');
      const offer = await client.wpost<RetainedReclaimOffer>('/workers/retained/reclaim', { directories: selected });
      emit(offer, () => {
        table(offer.cards, [
          { header: 'CARD', get: (c) => c.decisionId },
          { header: 'COPIES', get: (c) => String(c.directories.length), align: 'right' },
          { header: 'FREES', get: (c) => formatBytes(c.bytes), align: 'right' },
          { header: 'KIND', get: (c) => (c.own ? 'own card (unpushed or copy-only commits)' : 'shared card') },
        ], { empty: 'no card raised' });
        for (const s of offer.skipped) write(style.dim(`not offered ${s.directory}: ${s.reason}`));
        if (offer.cards.length) write(`${style.ok('offered')} — nothing has been removed. Approve or keep each card in Needs you.`);
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
  ignoreAge: boolean;
  windowDays: number;
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

const RETAINED_POLL_MS = 2_000;

function ageDays(c: RetainedCopy): string {
  if (!c.ageFrom) return '';
  const days = Math.floor((Date.now() - Date.parse(c.ageFrom)) / 86_400_000);
  return Number.isFinite(days) ? `${days}d` : '';
}

/** `2 modified, 3 untracked; 4 commits not landed (1 unpushed); branch gone`. */
export function whyKept(c: RetainedCopy): string {
  const parts: string[] = [];
  if (c.reasons.includes('uncommitted') && c.uncommitted) parts.push(`${c.uncommitted.tracked} modified, ${c.uncommitted.untracked} untracked`);
  if (c.reasons.includes('commits_not_on_landing_branch')) {
    const n = Math.max(c.commitsNotOnLandingBranch ?? 0, c.commitsOnlyHere ?? 0);
    parts.push(`${n} commit(s) not landed${c.commitsOnNoRemote ? ` (${c.commitsOnNoRemote} unpushed)` : ''}`);
  }
  if (c.reasons.includes('branch_gone')) parts.push('branch gone from the clone');
  if (c.reasons.includes('unreadable')) parts.push(`unreadable${c.error ? `: ${c.error.slice(0, 60)}` : ''}`);
  return parts.join('; ') || (c.class === 'orphan' ? 'no agent or ticket' : '');
}
