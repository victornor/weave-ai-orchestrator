import { describe, expect, it } from 'vitest';
import { TICKET_STATUSES } from '@agent-conductor/shared';
import { BOARD_COLUMNS, STATUS_COLUMN, filterTickets, foldBoard, isFolded } from '../lib/board';
import { ticket } from './factories';

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
