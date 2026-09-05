import { describe, expect, it } from 'vitest';
import type { Agent } from '@agent-conductor/shared';
import { TICKET_STATUSES } from '@agent-conductor/shared';
import { BOARD_COLUMNS, STATUS_COLUMN, filterTickets, foldBoard, isFolded, isLiveWorker, liveWorkersByTicket, ticketBoardStatus } from '../lib/board';
import { agent, ticket } from './factories';

describe('board folding', () => {
  it('folds eleven statuses into six owner columns', () => {
    expect(BOARD_COLUMNS).toHaveLength(6);
    expect(TICKET_STATUSES).toHaveLength(11);
    for (const s of TICKET_STATUSES) {
      expect(BOARD_COLUMNS.map((c) => c.key)).toContain(STATUS_COLUMN[s]);
    }
  });

  it('folds exactly backlog, proposing, approved, merging and cancelled', () => {
    const folded = TICKET_STATUSES.filter(isFolded);
    expect(folded).toEqual(['backlog', 'proposing', 'approved', 'merging', 'cancelled']);
  });

  it('puts every ticket in exactly one column', () => {
    const tickets = TICKET_STATUSES.map((s, i) => ticket({ id: `t${i}`, status: s }));
    const cols = foldBoard(tickets);
    expect(cols.reduce((n, c) => n + c.items.length, 0)).toBe(tickets.length);
    const todo = cols.find((c) => c.key === 'todo');
    expect(todo?.items.map((t) => t.status).sort()).toEqual(['backlog', 'todo']);
    const inProgress = cols.find((c) => c.key === 'in_progress');
    expect(inProgress?.items.map((t) => t.status).sort()).toEqual(['approved', 'in_progress', 'proposing']);
    const inReview = cols.find((c) => c.key === 'in_review');
    expect(inReview?.items.map((t) => t.status).sort()).toEqual(['in_review', 'merging']);
    const done = cols.find((c) => c.key === 'done');
    expect(done?.items.map((t) => t.status).sort()).toEqual(['cancelled', 'done']);
  });

  it('sorts a column by priority then status order', () => {
    const cols = foldBoard([
      ticket({ id: 'a', status: 'in_progress', priority: 'low' }),
      ticket({ id: 'b', status: 'proposing', priority: 'critical' }),
      ticket({ id: 'c', status: 'approved', priority: 'critical' }),
    ]);
    const col = cols.find((c) => c.key === 'in_progress');
    expect(col?.items.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('filters by project, kind and priority', () => {
    const ts = [
      ticket({ id: 'a', projectId: 'p1', kind: 'change', priority: 'high' }),
      ticket({ id: 'b', projectId: 'p2', kind: 'task', priority: 'low' }),
    ];
    expect(filterTickets(ts, { project: 'p2' }).map((t) => t.id)).toEqual(['b']);
    expect(filterTickets(ts, { kind: 'change' }).map((t) => t.id)).toEqual(['a']);
    expect(filterTickets(ts, { priority: 'low' }).map((t) => t.id)).toEqual(['b']);
    expect(filterTickets(ts, {})).toHaveLength(2);
  });
});

describe('live workers on the board', () => {
  const live = (...workers: Agent[]) => liveWorkersByTicket(workers);
  const columnOf = (id: string, cols: ReturnType<typeof foldBoard>) => cols.find((c) => c.items.some((t) => t.id === id))?.key;

  it('counts a spawned, active or running worker as live and nothing else', () => {
    for (const status of ['provisioning', 'active', 'running'] as const) expect(isLiveWorker(agent({ status }))).toBe(true);
    for (const status of ['paused', 'error', 'done', 'retired'] as const) expect(isLiveWorker(agent({ status }))).toBe(false);
    expect(isLiveWorker(null)).toBe(false);
  });

  it('shows a todo ticket with a live worker in In progress, and leaves it in Todo without one', () => {
    const t = ticket({ id: 'tk_1', status: 'todo' });
    expect(columnOf('tk_1', foldBoard([t], live(agent({ ticketId: 'tk_1', status: 'running' }))))).toBe('in_progress');
    expect(columnOf('tk_1', foldBoard([t]))).toBe('todo');
    expect(ticketBoardStatus('todo', { live: true })).toBe('working');
    // The card must still say which status it really is, now that it is not in Todo.
    expect(isFolded('todo', { live: true })).toBe(true);
    expect(isFolded('todo')).toBe(false);
  });

  it('takes a merging ticket out of In review and marks it merging, worker or not', () => {
    const t = ticket({ id: 'tk_1', status: 'merging' });
    expect(columnOf('tk_1', foldBoard([t], live(agent({ ticketId: 'tk_1', status: 'running' }))))).toBe('in_progress');
    expect(columnOf('tk_1', foldBoard([t]))).toBe('in_review');
    expect(ticketBoardStatus('merging', { live: true })).toBe('merging');
    expect(ticketBoardStatus('merging')).toBe('merging');
    expect(ticketBoardStatus('in_review')).toBe('needs-you');
  });

  it('keeps a proposed ticket with an active worker in Proposed: the human owns the next move', () => {
    const t = ticket({ id: 'tk_1', status: 'proposed' });
    expect(columnOf('tk_1', foldBoard([t], live(agent({ ticketId: 'tk_1', status: 'active' }))))).toBe('proposed');
    expect(ticketBoardStatus('proposed', { live: true })).toBe('needs-you');
  });

  it('keeps a blocked ticket in Blocked even while its worker is up', () => {
    const t = ticket({ id: 'tk_1', status: 'blocked' });
    expect(columnOf('tk_1', foldBoard([t], live(agent({ ticketId: 'tk_1', status: 'active' }))))).toBe('blocked');
  });

  it('ignores a retired worker the ticket still names', () => {
    const t = ticket({ id: 'tk_1', status: 'todo', workerId: 'a1' });
    expect(columnOf('tk_1', foldBoard([t], live(agent({ id: 'a1', ticketId: 'tk_1', status: 'retired' }))))).toBe('todo');
  });

  it('prefers the newest live worker when a ticket was relaunched', () => {
    const map = live(
      agent({ id: 'a1', ticketId: 'tk_1', name: 'Engineer #1', createdAt: '2026-09-01T09:00:00.000Z' }),
      agent({ id: 'a2', ticketId: 'tk_1', name: 'Engineer #2', createdAt: '2026-09-02T09:00:00.000Z' }),
    );
    expect(map.get('tk_1')?.name).toBe('Engineer #2');
  });

  it('lets an open decision and a stall still win over a live worker', () => {
    expect(ticketBoardStatus('todo', { live: true, needsYou: true })).toBe('needs-you');
    expect(ticketBoardStatus('todo', { live: true, stalled: true })).toBe('stalled');
  });
});
