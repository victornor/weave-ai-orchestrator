/**
 * The per-project merge queue's waiting order (PLAN §11.4, VS-390). Waiting tickets are admitted by
 * priority, then by join time, then by ticket number — except that a ticket bypassed
 * `MERGE_BYPASS_LIMIT` times is admitted before any ticket that has not been bypassed, so priority
 * can never starve the tail. The order is a pure function of queue state so the daemon and the web
 * app share one rule.
 */
import type { TicketPriority } from './enums.js';

/** How many times a waiting ticket may be passed over before it outranks every non-bypassed ticket. */
export const MERGE_BYPASS_LIMIT = 3;

const PRIORITY_RANK: Record<TicketPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Lower is earlier. Unknown values sort as `medium`, matching the column's default. */
export function mergePriorityRank(priority: TicketPriority): number {
  return PRIORITY_RANK[priority] ?? PRIORITY_RANK.medium;
}

/** The three ticket facts the waiting order reads; a full `Ticket` satisfies it. */
export interface MergeQueueOrderable {
  priority: TicketPriority;
  mergeQueuedAt: string | null;
  number: number;
  mergeBypasses: number;
}

/** Epoch millis of the join time; a null join time (a pre-upgrade row) sorts earliest. */
export function mergeQueueJoinedAt(entry: MergeQueueOrderable): number {
  return entry.mergeQueuedAt ? Date.parse(entry.mergeQueuedAt) : 0;
}

/** True once the ticket has been passed over the bypass limit and must be admitted first. */
export function isMergeStarved(entry: MergeQueueOrderable): boolean {
  return entry.mergeBypasses >= MERGE_BYPASS_LIMIT;
}

/** Join order: `a` joined before `b`, the ticket number breaking a same-tick tie. */
export function mergeQueueJoinedEarlier(a: MergeQueueOrderable, b: MergeQueueOrderable): boolean {
  const ja = mergeQueueJoinedAt(a);
  const jb = mergeQueueJoinedAt(b);
  return ja < jb || (ja === jb && a.number < b.number);
}

/** The queue's waiting order: starved tickets first (by join time), then priority, then join time, then number. */
export function compareMergeQueue(a: MergeQueueOrderable, b: MergeQueueOrderable): number {
  const aStarved = isMergeStarved(a);
  const bStarved = isMergeStarved(b);
  if (aStarved !== bStarved) return aStarved ? -1 : 1;
  if (!aStarved) {
    const byPriority = mergePriorityRank(a.priority) - mergePriorityRank(b.priority);
    if (byPriority !== 0) return byPriority;
  }
  return mergeQueueJoinedAt(a) - mergeQueueJoinedAt(b) || a.number - b.number;
}
