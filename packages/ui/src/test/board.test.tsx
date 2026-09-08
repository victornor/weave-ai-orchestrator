import { describe, expect, it } from 'vitest';
import type { Agent } from '@agent-conductor/shared';
import { TICKET_STATUSES } from '@agent-conductor/shared';
import {
  BOARD_COLUMNS,
  RECENT_FINISHED_MAX,
  STATUS_COLUMN,
  filterTickets,
  finishedAt,
  finishedModeFromSearch,
  finishedModeSearch,
  foldBoard,
  isFolded,
  isLiveWorker,
  liveWorkersByTicket,
  mergeStrip,
  pausedWorkersByTicket,
  recentlyFinished,
  ticketBoardStatus,
} from '../lib/board';
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
    const folded = TICKET_STATUSES.filter((s) => isFolded(s));
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

describe('paused workers on the board (VS-137)', () => {
  it('is never in liveWorkersByTicket, since paused is not a live status', () => {
    const paused = agent({ ticketId: 'tk_1', status: 'paused' });
    expect(liveWorkersByTicket([paused]).has('tk_1')).toBe(false);
  });

  it('finds a ticket\'s paused worker independently of the live map', () => {
    const map = pausedWorkersByTicket([
      agent({ id: 'a1', ticketId: 'tk_1', status: 'paused' }),
      agent({ id: 'a2', ticketId: 'tk_2', status: 'active' }),
    ]);
    expect(map.get('tk_1')?.id).toBe('a1');
    expect(map.has('tk_2')).toBe(false);
  });

  it('prefers the newest paused worker when a ticket was relaunched', () => {
    const map = pausedWorkersByTicket([
      agent({ id: 'a1', ticketId: 'tk_1', status: 'paused', createdAt: '2026-09-01T09:00:00.000Z' }),
      agent({ id: 'a2', ticketId: 'tk_1', status: 'paused', createdAt: '2026-09-02T09:00:00.000Z' }),
    ]);
    expect(map.get('tk_1')?.id).toBe('a2');
  });
});

describe('finished tickets on the board', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  const daysAgo = (n: number): string => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  it('reads the finished mode out of ?done= and writes it back, keeping the old ?done=1 meaning', () => {
    expect(finishedModeFromSearch(undefined)).toBe('recent');
    expect(finishedModeFromSearch('')).toBe('recent');
    expect(finishedModeFromSearch(1)).toBe('all');
    expect(finishedModeFromSearch('all')).toBe('all');
    expect(finishedModeFromSearch('0')).toBe('hide');
    expect(finishedModeFromSearch('hide')).toBe('hide');
    for (const mode of ['recent', 'all', 'hide'] as const) {
      expect(finishedModeFromSearch(finishedModeSearch(mode))).toBe(mode);
    }
    expect(finishedModeSearch('recent')).toBeUndefined();
  });

  it('takes when a ticket finished from completedAt, then cancelledAt, then updatedAt', () => {
    expect(finishedAt(ticket({ completedAt: daysAgo(1), cancelledAt: daysAgo(2), updatedAt: daysAgo(3) }))).toBe(daysAgo(1));
    expect(finishedAt(ticket({ completedAt: null, cancelledAt: daysAgo(2), updatedAt: daysAgo(3) }))).toBe(daysAgo(2));
    expect(finishedAt(ticket({ completedAt: null, cancelledAt: null, updatedAt: daysAgo(3) }))).toBe(daysAgo(3));
  });

  it('keeps the last seven days, newest first, capped at twenty', () => {
    const recent = recentlyFinished(
      [
        ticket({ id: 'old', status: 'done', completedAt: daysAgo(9) }),
        ticket({ id: 'mid', status: 'done', completedAt: daysAgo(3) }),
        ticket({ id: 'new', status: 'cancelled', cancelledAt: daysAgo(1), completedAt: null }),
      ],
      now,
    );
    expect(recent.map((t) => t.id)).toEqual(['new', 'mid']);

    const many = Array.from({ length: 25 }, (_, i) => ticket({ id: `t${i}`, status: 'done', completedAt: daysAgo(i / 25) }));
    expect(recentlyFinished(many, now)).toHaveLength(RECENT_FINISHED_MAX);
  });

  it('sorts the Done column by when tickets finished, not by priority', () => {
    const cols = foldBoard([
      ticket({ id: 'a', status: 'done', priority: 'low', completedAt: daysAgo(0) }),
      ticket({ id: 'b', status: 'cancelled', priority: 'critical', cancelledAt: daysAgo(1), completedAt: null }),
      ticket({ id: 'c', status: 'done', priority: 'critical', completedAt: daysAgo(2) }),
    ]);
    expect(cols.find((c) => c.key === 'done')?.items.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('mergeStrip', () => {
  it('splits merging tickets into what is landing and what is waiting', () => {
    const counts = mergeStrip([
      ticket({ id: 'a', status: 'merging', mergeQueuedAt: '2026-09-01T10:00:00.000Z', mergeStartedAt: '2026-09-01T10:00:01.000Z' }),
      ticket({ id: 'b', status: 'merging', mergeQueuedAt: '2026-09-01T10:05:00.000Z' }),
      ticket({ id: 'c', status: 'merging', mergeQueuedAt: '2026-09-01T10:06:00.000Z' }),
      ticket({ id: 'd', status: 'in_review' }),
    ]);
    expect(counts).toEqual({ landing: 1, waiting: 2 });
  });

  it('counts nothing when nothing is merging', () => {
    expect(mergeStrip([ticket({ status: 'in_progress' })])).toEqual({ landing: 0, waiting: 0 });
    expect(mergeStrip([])).toEqual({ landing: 0, waiting: 0 });
  });
});
