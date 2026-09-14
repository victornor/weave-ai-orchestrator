/** The V2 Work board's pure fold: the six columns, the live-worker rule and the needs-you override. */
import { describe, expect, it } from 'vitest';
import type { TicketStatus } from '@weave-ai/shared';
import { ticket } from './factories';
import {
  foldV2Board,
  highlightSegments,
  needsYouTicketIds,
  v2ColumnFor,
  v2ShownFinished,
  type V2BoardColumnKey,
} from '../v2/work/board';

const expected: Record<TicketStatus, V2BoardColumnKey> = {
  backlog: 'todo',
  todo: 'todo',
  proposing: 'proposed',
  proposed: 'proposed',
  approved: 'in_progress',
  in_progress: 'in_progress',
  in_review: 'in_review',
  merging: 'in_review',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'done',
};

describe('the V2 column fold', () => {
  it('folds every status into its specified column', () => {
    for (const [status, column] of Object.entries(expected) as Array<[TicketStatus, V2BoardColumnKey]>) {
      expect(v2ColumnFor(status), status).toBe(column);
    }
  });

  it('puts a live worker on a non-human-owned ticket In progress', () => {
    expect(v2ColumnFor('approved', { live: true })).toBe('in_progress');
    expect(v2ColumnFor('in_progress', { live: true })).toBe('in_progress');
  });

  it('keeps a human-owned ticket in its own column though a worker is live', () => {
    expect(v2ColumnFor('proposed', { live: true })).toBe('proposed');
    expect(v2ColumnFor('in_review', { live: true })).toBe('in_review');
    expect(v2ColumnFor('blocked', { live: true })).toBe('blocked');
  });

  it('sends a ticket with an open human decision to Proposed, ahead of status and liveness', () => {
    expect(v2ColumnFor('blocked', { needsYou: true, live: true })).toBe('proposed');
    expect(v2ColumnFor('todo', { needsYou: true })).toBe('proposed');
  });
});

describe('the needs-you set', () => {
  it('keeps an open human decision and excludes one the daemon will auto-approve', () => {
    const tickets = new Map([['tk_1', { projectId: 'p1' }], ['tk_2', { projectId: 'p1' }]]);
    const projects = [{ id: 'p1', policies: { yolo: true } }];
    const decisions = [
      { ticketId: 'tk_1', kind: 'question' as const, status: 'open' as const },
      { ticketId: 'tk_2', kind: 'plan_approval' as const, status: 'open' as const },
    ];
    const ids = needsYouTicketIds(decisions, tickets, projects, { defaults: { yolo: true } });
    expect(ids.has('tk_1')).toBe(true);
    expect(ids.has('tk_2')).toBe(false);
  });

  it('counts a plan approval when YOLO is off', () => {
    const tickets = new Map([['tk_1', { projectId: 'p1' }]]);
    const projects = [{ id: 'p1', policies: {} }];
    const ids = needsYouTicketIds(
      [{ ticketId: 'tk_1', kind: 'plan_approval', status: 'open' }],
      tickets,
      projects,
      { defaults: { yolo: false } },
    );
    expect(ids.has('tk_1')).toBe(true);
  });
});

describe('folding a ticket set', () => {
  it('moves a blocked ticket with an open decision into Proposed', () => {
    const t = ticket({ id: 'tk_1', status: 'blocked' });
    const cols = foldV2Board([t], { needsYou: { has: (id) => id === 'tk_1' } });
    const proposed = cols.find((c) => c.key === 'proposed');
    const blocked = cols.find((c) => c.key === 'blocked');
    expect(proposed?.items).toHaveLength(1);
    expect(blocked?.items).toHaveLength(0);
  });

  it('orders a column by priority then recency', () => {
    const low = ticket({ id: 'tk_low', status: 'todo', priority: 'low', updatedAt: '2026-09-02T00:00:00.000Z' });
    const high = ticket({ id: 'tk_high', status: 'todo', priority: 'high', updatedAt: '2026-09-01T00:00:00.000Z' });
    const cols = foldV2Board([low, high]);
    expect(cols.find((c) => c.key === 'todo')?.items.map((t) => t.id)).toEqual(['tk_high', 'tk_low']);
  });
});

describe('the finished window', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  const recentCancelled = ticket({
    id: 'tk_c',
    status: 'cancelled',
    completedAt: null,
    cancelledAt: '2026-09-09T12:00:00.000Z',
  });
  const oldDone = ticket({ id: 'tk_d', status: 'done', completedAt: '2026-08-01T12:00:00.000Z' });

  it('shows recently finished tickets including cancelled ones, and hides the old', () => {
    const shown = v2ShownFinished([recentCancelled, oldDone], 'recent', now);
    expect(shown.map((t) => t.id)).toEqual(['tk_c']);
  });

  it('shows every finished ticket under all, and none under hide', () => {
    expect(v2ShownFinished([recentCancelled, oldDone], 'all', now)).toHaveLength(2);
    expect(v2ShownFinished([recentCancelled, oldDone], 'hide', now)).toHaveLength(0);
  });
});

describe('title highlights', () => {
  it('splits on a case-insensitive substring', () => {
    expect(highlightSegments('Deploy the pipeline', 'deploy')).toEqual([
      { text: 'Deploy', match: true },
      { text: ' the pipeline', match: false },
    ]);
  });

  it('escapes regex metacharacters so the query matches literally', () => {
    expect(highlightSegments('a.b.c', 'a.b')).toEqual([
      { text: 'a.b', match: true },
      { text: '.c', match: false },
    ]);
  });

  it('leaves the text alone for an empty query', () => {
    expect(highlightSegments('nothing', '')).toEqual([{ text: 'nothing', match: false }]);
  });
});
