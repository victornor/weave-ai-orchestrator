import { describe, expect, it } from 'vitest';
import { compareMergeQueue, isMergeStarved, MERGE_BYPASS_LIMIT, mergeQueueJoinedAt, mergePriorityRank, type MergeQueueOrderable } from './merge-queue.js';
import type { TicketPriority } from './enums.js';

const entry = (over: Partial<MergeQueueOrderable> = {}): MergeQueueOrderable => ({
  priority: 'medium' as TicketPriority,
  mergeQueuedAt: '2026-09-14T10:00:00.000Z',
  number: 1,
  mergeBypasses: 0,
  ...over,
});

describe('compareMergeQueue (VS-390)', () => {
  it('ranks priorities critical, high, medium, low', () => {
    expect(mergePriorityRank('critical')).toBeLessThan(mergePriorityRank('high'));
    expect(mergePriorityRank('high')).toBeLessThan(mergePriorityRank('medium'));
    expect(mergePriorityRank('medium')).toBeLessThan(mergePriorityRank('low'));
  });

  it('puts a critical ahead of earlier-joined mediums', () => {
    const first = entry({ number: 1, priority: 'medium', mergeQueuedAt: '2026-09-14T10:00:00.000Z' });
    const second = entry({ number: 2, priority: 'medium', mergeQueuedAt: '2026-09-14T10:01:00.000Z' });
    const critical = entry({ number: 9, priority: 'critical', mergeQueuedAt: '2026-09-14T10:05:00.000Z' });
    expect([second, first, critical].sort(compareMergeQueue)[0]).toBe(critical);
  });

  it('keeps join order within a priority', () => {
    const later = entry({ number: 5, mergeQueuedAt: '2026-09-14T10:05:00.000Z' });
    const earlier = entry({ number: 4, mergeQueuedAt: '2026-09-14T10:04:00.000Z' });
    expect([later, earlier].sort(compareMergeQueue).map((e) => e.number)).toEqual([4, 5]);
  });

  it('breaks equal priority and equal join time on ticket number', () => {
    const joinedAt = '2026-09-14T10:00:00.000Z';
    const high = entry({ number: 8, mergeQueuedAt: joinedAt });
    const low = entry({ number: 3, mergeQueuedAt: joinedAt });
    expect([high, low].sort(compareMergeQueue).map((e) => e.number)).toEqual([3, 8]);
  });

  it('sorts a bypassed ticket ahead of a fresh critical', () => {
    const starved = entry({ number: 1, priority: 'low', mergeQueuedAt: '2026-09-14T09:00:00.000Z', mergeBypasses: MERGE_BYPASS_LIMIT });
    const critical = entry({ number: 9, priority: 'critical', mergeQueuedAt: '2026-09-14T10:05:00.000Z', mergeBypasses: 0 });
    expect(isMergeStarved(starved)).toBe(true);
    expect([critical, starved].sort(compareMergeQueue)[0]).toBe(starved);
  });

  it('orders bypassed tickets by join time, not priority', () => {
    const older = entry({ number: 7, priority: 'low', mergeQueuedAt: '2026-09-14T09:00:00.000Z', mergeBypasses: 5 });
    const newer = entry({ number: 2, priority: 'critical', mergeQueuedAt: '2026-09-14T09:30:00.000Z', mergeBypasses: MERGE_BYPASS_LIMIT });
    expect([newer, older].sort(compareMergeQueue)[0]).toBe(older);
  });

  it('does not starve a ticket one bypass short of the limit', () => {
    const almost = entry({ priority: 'low', mergeBypasses: MERGE_BYPASS_LIMIT - 1 });
    const critical = entry({ priority: 'critical', number: 9, mergeBypasses: 0 });
    expect(isMergeStarved(almost)).toBe(false);
    expect([almost, critical].sort(compareMergeQueue)[0]).toBe(critical);
  });

  it('sorts a pre-upgrade row with no join time earliest', () => {
    expect(mergeQueueJoinedAt(entry({ mergeQueuedAt: null }))).toBe(0);
    const noJoin = entry({ number: 9, mergeQueuedAt: null });
    const joined = entry({ number: 1, mergeQueuedAt: '2026-09-14T10:00:00.000Z' });
    expect([joined, noJoin].sort(compareMergeQueue)[0]).toBe(noJoin);
  });
});
