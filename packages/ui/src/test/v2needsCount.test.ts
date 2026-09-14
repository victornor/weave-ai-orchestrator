/** The Needs you count rule (VS-411): only cards captain can act on are counted. */
import { describe, expect, it } from 'vitest';
import { countsAsNeeds } from '../v2/needsCount';

const REVIEW_KINDS = ['plan_approval', 'merge_approval', 'action_approval'] as const;
const OTHER_KINDS = ['question', 'concern', 'gate_finding', 'approval', 'hire_approval', 'discard_approval', 'retry_approval'] as const;

describe('the Needs you count rule', () => {
  it('leaves out a plan, merge or action card still waiting for the weaver review', () => {
    for (const kind of REVIEW_KINDS) {
      expect(countsAsNeeds({ kind, weaverReviewStatus: 'unseen' })).toBe(false);
    }
  });

  it('counts one the weaver has looked at or raised concerns about', () => {
    for (const kind of REVIEW_KINDS) {
      expect(countsAsNeeds({ kind, weaverReviewStatus: 'looked' })).toBe(true);
      expect(countsAsNeeds({ kind, weaverReviewStatus: 'concerns' })).toBe(true);
    }
  });

  it('counts a human-owned question and every kind that does not carry weaver review', () => {
    for (const kind of OTHER_KINDS) {
      expect(countsAsNeeds({ kind, weaverReviewStatus: 'unseen' })).toBe(true);
    }
  });
});
