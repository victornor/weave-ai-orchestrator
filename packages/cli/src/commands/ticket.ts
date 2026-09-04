/** `conductor ticket ...` — the same commands for a human and, with AC_RUN_TOKEN, for an agent (PLAN §9.5, §20). */
import type { Command } from 'commander';
import type { Ticket, TicketComment } from '@agent-conductor/shared';
import { TICKET_KINDS, TICKET_PRIORITIES, TICKET_STATUSES } from '@agent-conductor/shared';
import { ticketToSummary, formatRelative, oneLine } from '@agent-conductor/render';
import { ApiError } from '../api.js';
import { emit, fields, heading, style, table, write } from '../output.js';
import { promptTyped } from '../prompt.js';
import { items, list, run, session, unwrap } from './util.js';

function ticketUrl(baseUrl: string, workspace: string | null, ticket: Record<string, unknown>): string {
  const id = String(ticket['identifier'] ?? ticket['id'] ?? '');
  return `${baseUrl}/w/${workspace ?? ''}/tickets/${encodeURIComponent(id)}`;
}

export function register(program: Command): void {
  const ticket = program.command('ticket').description('tickets');

  ticket
    .command('create')
    .argument('<title...>')
    .description('create a ticket')
    .option('-p, --project <id>')
    .option('-k, --kind <kind>', `one of ${TICKET_KINDS.join('|')}`, 'task')
    .option('--priority <priority>', `one of ${TICKET_PRIORITIES.join('|')}`, 'medium')
    .option('-d, --description <text>', 'description', '')
    .option('--parent <id>', 'parent ticket')
    .option('--blocked-by <ids>', 'comma-separated blocking ticket ids')
    .option('--assign <roleId>', 'assign to a role immediately')
    .option('--auto-merge', 'merge without a merge decision when checks pass')
    .action(async (title: string[], opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const input: Record<string, unknown> = {
        title: title.join(' '),
        kind: String(opts['kind'] ?? 'task'),
        priority: String(opts['priority'] ?? 'medium'),
        description: String(opts['description'] ?? ''),
      };
      if (opts['project']) input['projectId'] = String(opts['project']);
      if (opts['parent']) input['parentId'] = String(opts['parent']);
      if (opts['blockedBy']) input['blockedBy'] = list(String(opts['blockedBy']));
      if (opts['assign']) input['assigneeRoleId'] = String(opts['assign']);
      if (opts['autoMerge'] === true) input['autoMerge'] = true;

      const created = await client.write<Ticket>({
        tool: 'ac_ticket_create', input,
        http: { method: 'POST', path: client.w('/tickets'), body: input },
      });
      emit(created, () => {
        const summary = ticketToSummary(created, {});
        write(`${style.ok('created')} ${style.bold(summary.identifier)} ${summary.title}`);
      });
    }));

  ticket
    .command('list', { isDefault: true })
    .description('list tickets')
    .option('-p, --project <id>')
    .option('-s, --status <statuses>', `comma-separated: ${TICKET_STATUSES.join(',')}`)
    .option('-k, --kind <kinds>', 'comma-separated kinds')
    .option('-r, --role <roleId>')
    .option('--search <text>')
    .option('--limit <n>', 'max rows', '50')
    .option('--offset <n>', 'skip rows', '0')
    .action(async (opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const query = {
        project: opts['project'], status: opts['status'], kind: opts['kind'], role: opts['role'],
        search: opts['search'], limit: opts['limit'], offset: opts['offset'],
      };
      const payload = client.isAgent
        ? await client.tool<unknown>('ac_ticket_list', query as Record<string, unknown>)
        : await client.wget<unknown>('/tickets', query);
      const rows = items<Ticket>(payload, 'tickets').map((t) => ticketToSummary(t, {}));
      emit(payload, () => {
        table(rows, [
          { header: '', get: (r) => r.glyph },
          { header: 'ID', get: (r) => r.identifier },
          { header: 'TITLE', get: (r) => oneLine(r.title, 60) },
          { header: 'KIND', get: (r) => r.kind },
          { header: 'STATUS', get: (r) => r.status },
          { header: 'PRIORITY', get: (r) => r.priority },
          { header: 'PROJECT', get: (r) => r.project ?? '' },
          { header: 'AGE', get: (r) => r.age, align: 'right' },
        ], { empty: 'no tickets match' });
      });
    }));

  ticket
    .command('show')
    .argument('<id>', 'ticket id or identifier')
    .description('ticket detail with comments, blockers and work products')
    .option('--comments <n>', 'how many recent comments to print', '10')
    .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.write<Record<string, unknown>>({
        tool: 'ac_ticket_get', input: { ticketId: id },
        http: { method: 'GET', path: client.w(`/tickets/${encodeURIComponent(id)}`) },
      });
      const t = unwrap<Ticket>(payload, 'ticket');
      emit(payload, () => {
        const summary = ticketToSummary(t, {});
        heading(`${summary.glyph} ${summary.identifier}  ${summary.title}`);
        fields([
          ['status', `${t.status}${t.autoMerge ? ' · auto-merge' : ''}`],
          ['kind', String(t.kind ?? '')],
          ['priority', String(t.priority ?? '')],
          ['project', String(t.projectId ?? '')],
          ['role', String(t.assigneeRoleId ?? '')],
          ['worker', String(t.workerId ?? '')],
          ['created', formatRelative(t.createdAt)],
          ['openspec', t.openspecChangeName ? String(t.openspecChangeName) : undefined],
          ['unblock', t.unblock ? `${t.unblock.owner}: ${t.unblock.action}` : undefined],
        ]);
        if (t.description) {
          write('');
          write(String(t.description));
        }
        const blockers = items<Record<string, unknown>>(payload['blockers']);
        if (blockers.length) {
          write('');
          heading('Blocked by');
          table(blockers, [
            { header: 'ID', get: (b) => String(b['identifier'] ?? b['id'] ?? '') },
            { header: 'STATUS', get: (b) => String(b['status'] ?? '') },
            { header: 'TITLE', get: (b) => oneLine(String(b['title'] ?? ''), 60) },
          ]);
        }
        const products = items<Record<string, unknown>>(payload['workProducts']);
        if (products.length) {
          write('');
          heading('Work products');
          table(products, [
            { header: 'TYPE', get: (p) => String(p['type'] ?? '') },
            { header: 'STATE', get: (p) => String(p['state'] ?? '') },
            { header: 'URL', get: (p) => String(p['url'] ?? '') },
          ]);
        }
        const comments = items<TicketComment>(payload['comments']).slice(-Number(opts['comments'] ?? 10));
        if (comments.length) {
          write('');
          heading('Recent comments');
          for (const c of comments) {
            write(`${style.dim(`${formatRelative(c.createdAt)} · ${c.authorKind}${c.kind && c.kind !== 'comment' ? ` · ${c.kind}` : ''}`)}`);
            write(String(c.body ?? ''));
            write('');
          }
        }
      });
    }));

  ticket
    .command('assign')
    .argument('<id>')
    .argument('<roleId>')
    .description('assign a ticket to a role')
    .action(async (id: string, roleId: string, _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.write({
        tool: 'ac_ticket_assign', input: { ticketId: id, roleId },
        http: { method: 'POST', path: client.w(`/tickets/${encodeURIComponent(id)}/assign`), body: { roleId } },
      });
      emit(result, () => write(`${style.ok('assigned')} ${id} -> ${roleId}`));
    }));

  ticket
    .command('set')
    .argument('<id>')
    .description('update ticket fields')
    .option('--title <title>')
    .option('--description <text>')
    .option('--priority <priority>')
    .option('--auto-merge', 'turn auto-merge on')
    .option('--no-auto-merge', 'turn auto-merge off')
    .action(async (id: string, opts: Record<string, string | boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const body: Record<string, unknown> = {};
      if (opts['title']) body['title'] = String(opts['title']);
      if (opts['description']) body['description'] = String(opts['description']);
      if (opts['priority']) body['priority'] = String(opts['priority']);
      if (opts['autoMerge'] !== undefined) body['autoMerge'] = opts['autoMerge'] === true;
      if (Object.keys(body).length === 0) throw new ApiError('validation', 'nothing to set: pass --title, --description, --priority or --auto-merge', 400);
      const result = await client.patch(client.w(`/tickets/${encodeURIComponent(id)}`), body);
      emit(result, () => write(`${style.ok('updated')} ${id}: ${Object.keys(body).join(', ')}`));
    }));

  ticket
    .command('transition')
    .argument('<id>')
    .argument('<status>', TICKET_STATUSES.join('|'))
    .option('--note <note>')
    .option('--blocked-by <ids>', 'comma-separated ticket ids (when moving to blocked)')
    .option('--unblock-owner <owner>', 'conductor|human')
    .option('--unblock-action <action>', 'what has to happen to unblock')
    .description('move a ticket through the state machine')
    .action(async (id: string, status: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const input: Record<string, unknown> = { to: status };
      if (opts['note']) input['note'] = opts['note'];
      if (opts['blockedBy']) input['blockedBy'] = list(opts['blockedBy']);
      if (opts['unblockOwner'] && opts['unblockAction']) input['unblock'] = { owner: opts['unblockOwner'], action: opts['unblockAction'] };
      const result = await client.write({
        tool: 'ac_ticket_transition', input: { ticketId: id, ...input },
        http: { method: 'POST', path: client.w(`/tickets/${encodeURIComponent(id)}/transition`), body: input },
      });
      emit(result, () => write(`${style.ok('moved')} ${id} -> ${status}`));
    }));

  ticket
    .command('comment')
    .argument('<id>')
    .argument('<body...>')
    .description('comment on a ticket (wakes the worker)')
    .action(async (id: string, body: string[], _opts: unknown, command: Command) => run(async () => {
      const { client } = await session(command);
      const text = body.join(' ');
      const result = await client.write({
        tool: 'ac_ticket_comment', input: { ticketId: id, body: text },
        http: { method: 'POST', path: client.w(`/tickets/${encodeURIComponent(id)}/comments`), body: { body: text } },
      });
      emit(result, () => write(`${style.ok('commented')} on ${id}`));
    }));

  ticket
    .command('comments')
    .argument('<id>')
    .option('--after <iso>', 'only comments after this timestamp')
    .description('print the comment stream')
    .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.write<unknown>({
        tool: 'ac_ticket_comments', input: { ticketId: id, after: opts['after'] },
        http: { method: 'GET', path: client.w(`/tickets/${encodeURIComponent(id)}/comments`), query: { after: opts['after'] } },
      });
      const rows = items<TicketComment>(payload, 'comments');
      emit(payload, () => {
        for (const c of rows) {
          write(style.dim(`${formatRelative(c.createdAt)} · ${c.authorKind}${c.kind && c.kind !== 'comment' ? ` · ${c.kind}` : ''}`));
          write(String(c.body ?? ''));
          write('');
        }
        if (rows.length === 0) write(style.dim('no comments'));
      });
    }));

  ticket
    .command('cancel')
    .argument('<id>')
    .option('--reason <reason>', 'why', 'cancelled from the CLI')
    .description('cancel a ticket')
    .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const result = await client.wpost(`/tickets/${encodeURIComponent(id)}/cancel`, { reason: opts['reason'] ?? '' });
      emit(result, () => write(`${style.ok('cancelled')} ${id}`));
    }));

  ticket
    .command('discard')
    .argument('<id>')
    .option('--force', 'skip the typed confirmation (still needs the discard decision)')
    .description('discard a ticket worktree — destructive')
    .action(async (id: string, opts: Record<string, boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      if (opts['force'] !== true) {
        const confirmed = await promptTyped(id, `Type ${id} to discard its worktree and any uncommitted work`);
        if (!confirmed) {
          emit({ discarded: false, reason: 'not confirmed' }, () => write(style.dim('not confirmed — nothing was discarded')));
          return;
        }
      }
      const result = await client.wpost(`/tickets/${encodeURIComponent(id)}/discard`, { force: true });
      emit(result, () => {
        const decisionId = (result as Record<string, unknown> | null)?.['decisionId'];
        if (decisionId) write(`${style.warn('needs approval')} — answer decision ${String(decisionId)}`);
        else write(`${style.ok('discarded')} ${id}`);
      });
    }));

  ticket
    .command('open')
    .argument('<id>')
    .option('--pr', 'open the pull request instead of the ticket page')
    .option('--print', 'print the url instead of opening a browser')
    .description('open a ticket in the browser')
    .action(async (id: string, opts: Record<string, boolean>, command: Command) => run(async () => {
      const { client } = await session(command);
      const payload = await client.wget<Record<string, unknown>>(`/tickets/${encodeURIComponent(id)}`);
      const t = unwrap<Record<string, unknown>>(payload, 'ticket');
      let url = ticketUrl(client.baseUrl, client.workspace, t);
      if (opts['pr'] === true) {
        const products = items<Record<string, unknown>>(payload['workProducts']);
        const pr = products.find((p) => String(p['type']) === 'pull_request' && typeof p['url'] === 'string');
        if (!pr) throw new ApiError('not_found', `no pull request on ${id}`, 404);
        url = String(pr['url']);
      }
      if (opts['print'] === true) {
        emit({ url }, () => write(url));
        return;
      }
      const { default: openUrl } = await import('open');
      await openUrl(url);
      emit({ url, opened: true }, () => write(`${style.ok('opened')} ${url}`));
    }));

  ticket
    .command('retry <id>')
    .description('relaunch the worker (or spawn one) after a failure or a parked usage limit')
    .option('-m, --note <text>', 'what to tell the worker')
    .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const t = unwrap<Record<string, unknown>>(await client.wpost(`/tickets/${encodeURIComponent(id)}/retry`, opts['note'] ? { note: opts['note'] } : {}), 'ticket');
      emit(t, () => write(`${style.ok('retrying')} ${String(t['identifier'])} · ${String(t['status'])}`));
    }));

  ticket
    .command('reopen <id>')
    .description('reopen a done or cancelled ticket; a worker picks it up on its branch')
    .option('-m, --note <text>', 'why, shown on the ticket')
    .action(async (id: string, opts: Record<string, string>, command: Command) => run(async () => {
      const { client } = await session(command);
      const cur = unwrap<Record<string, unknown>>(await client.wget(`/tickets/${encodeURIComponent(id)}`), 'ticket');
      const to = cur['status'] === 'cancelled' ? 'todo' : 'in_progress';
      const t = unwrap<Record<string, unknown>>(await client.wpost(`/tickets/${encodeURIComponent(id)}/transition`, { to, note: opts['note'] ?? 'reopened' }), 'ticket');
      if (opts['note']) await client.wpost(`/tickets/${encodeURIComponent(id)}/comments`, { body: opts['note'] });
      emit(t, () => write(`${style.ok('reopened')} ${String(t['identifier'])} · ${String(t['status'])}`));
    }));
}
