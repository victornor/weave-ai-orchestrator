/**
 * Which open human decisions the Needs you badge counts (VS-411).
 *
 * The Needs you page lists every card captain can act on; the badge is a promise about action, so a
 * plan, merge or action card the weaver has not reviewed yet is not counted — its approving answer
 * is refused until the weaver marks it `looked` or `concerns` (`carriesWeaverReview`). A human-owned
 * question, and every other kind that does not carry weaver review, counts as it always has.
 *
 * Pure and separate from the screen so the rule can be tested without a router or a query client.
 */
import { carriesWeaverReview, type Decision } from '@weave-ai/shared';

export function countsAsNeeds(d: Pick<Decision, 'kind' | 'weaverReviewStatus'>): boolean {
  return !carriesWeaverReview(d.kind) || d.weaverReviewStatus !== 'unseen';
}
