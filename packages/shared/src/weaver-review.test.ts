import { describe, expect, it } from 'vitest';
import { EVENT_TYPES } from './events.js';
import {
  WEAVER_REVIEW_KINDS,
  WEAVER_REVIEW_STATUSES,
  type DecisionKind,
} from './enums.js';
import { weaverReviewCopy, reviewIsAfterAnswer, type WeaverReviewFields } from './weaver-review.js';

const PRIOR = '2026-09-11T02:54:00.000Z';
const LATER = '2026-09-11T02:56:00.000Z';

function fields(
  kind: DecisionKind,
  over: Partial<WeaverReviewFields> = {},
): WeaverReviewFields {
  return {
    kind,
    status: 'open',
    weaverReviewStatus: 'unseen',
    weaverReviewedAt: null,
    weaverReviewNote: null,
    answeredAt: null,
    ...over,
  };
}

describe('WEAVER_REVIEW_STATUSES (VS-223)', () => {
  it('is unseen, looked, concerns', () => {
    expect(WEAVER_REVIEW_STATUSES).toEqual(['unseen', 'looked', 'concerns']);
  });
});

describe('EVENT_TYPES (VS-223)', () => {
  it('includes decision.updated', () => {
    expect(EVENT_TYPES).toContain('decision.updated');
  });
});

describe('reviewIsAfterAnswer', () => {
  it('is true only when reviewedAt is strictly later than answeredAt', () => {
    expect(reviewIsAfterAnswer({ answeredAt: PRIOR, weaverReviewedAt: LATER })).toBe(true);
    expect(reviewIsAfterAnswer({ answeredAt: LATER, weaverReviewedAt: PRIOR })).toBe(false);
    expect(reviewIsAfterAnswer({ answeredAt: PRIOR, weaverReviewedAt: PRIOR })).toBe(false);
    expect(reviewIsAfterAnswer({ answeredAt: null, weaverReviewedAt: LATER })).toBe(false);
    expect(reviewIsAfterAnswer({ answeredAt: PRIOR, weaverReviewedAt: null })).toBe(false);
    expect(reviewIsAfterAnswer({ answeredAt: null, weaverReviewedAt: null })).toBe(false);
  });
});

describe('weaverReviewCopy', () => {
  it('returns null only for kinds that do not carry the state', () => {
    expect(weaverReviewCopy(fields('question'))).toBeNull();
    expect(weaverReviewCopy(fields('hire_approval'))).toBeNull();
    expect(weaverReviewCopy(fields('retry_approval'))).toBeNull();
    expect(weaverReviewCopy(fields('concern'))).toBeNull();
    expect(weaverReviewCopy(fields('discard_approval'))).toBeNull();
  });

  const timings = [
    { name: 'open', answeredAt: null as string | null, reviewedAt: null as string | null },
    { name: 'answered-prior', answeredAt: LATER, reviewedAt: PRIOR },
    { name: 'answered-after', answeredAt: PRIOR, reviewedAt: LATER },
  ] as const;

  it.each(WEAVER_REVIEW_KINDS)('%s always returns a non-empty line in every status and timing', (kind) => {
    for (const status of WEAVER_REVIEW_STATUSES) {
      for (const t of timings) {
        const copy = weaverReviewCopy(fields(kind, {
          weaverReviewStatus: status,
          weaverReviewedAt: status === 'unseen' ? null : t.reviewedAt,
          weaverReviewNote: status === 'concerns' ? 'the migration contradicts itself' : (status === 'looked' ? 'migration matches the plan' : null),
          answeredAt: t.answeredAt,
        }));
        expect(copy, `${kind} ${status} ${t.name}`).not.toBeNull();
        expect(copy!.line.length, `${kind} ${status} ${t.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('uses the exact unanswered and after-the-fact copy (VS-234)', () => {
    expect(weaverReviewCopy(fields('plan_approval'))).toEqual({
      line: "Weaver hasn't reviewed yet", note: null, tone: 'unseen', held: false,
    });
    expect(weaverReviewCopy(fields('merge_approval', {
      weaverReviewStatus: 'looked', weaverReviewedAt: PRIOR, weaverReviewNote: 'migration matches the plan',
    }))).toEqual({ line: 'Weaver reviewed — no concerns', note: 'migration matches the plan', tone: 'looked', held: false });
    expect(weaverReviewCopy(fields('action_approval', {
      weaverReviewStatus: 'looked', weaverReviewedAt: LATER, answeredAt: PRIOR, weaverReviewNote: 'diff is exactly the plan',
    }))).toEqual({ line: 'Weaver reviewed after you answered — no concerns', note: 'diff is exactly the plan', tone: 'after', held: false });
    expect(weaverReviewCopy(fields('plan_approval', {
      weaverReviewStatus: 'concerns', weaverReviewedAt: PRIOR,
      weaverReviewNote: 'split the migration',
    }))).toEqual({
      line: 'Weaver reviewed — has concerns', note: 'split the migration', tone: 'concerns', held: true,
    });
    expect(weaverReviewCopy(fields('merge_approval', {
      status: 'answered', weaverReviewStatus: 'concerns', weaverReviewedAt: LATER, answeredAt: PRIOR,
      weaverReviewNote: 'CI is red',
    }))).toEqual({
      line: 'Weaver reviewed after you answered — has concerns', note: 'CI is red', tone: 'concerns', held: false,
    });
  });

  it('renders a legacy clean mark with no note as the line alone (VS-234)', () => {
    const copy = weaverReviewCopy(fields('plan_approval', {
      weaverReviewStatus: 'looked', weaverReviewedAt: PRIOR, weaverReviewNote: null,
    }));
    expect(copy).toEqual({ line: 'Weaver reviewed — no concerns', note: null, tone: 'looked', held: false });
  });

  describe('held (VS-266)', () => {
    it('is true only for an open decision marked concerns', () => {
      expect(weaverReviewCopy(fields('plan_approval', {
        status: 'open', weaverReviewStatus: 'concerns', weaverReviewedAt: PRIOR, weaverReviewNote: 'needs work',
      }))!.held).toBe(true);
    });

    it('is false once the decision is no longer open, even with a concerns mark', () => {
      for (const status of ['answered', 'superseded', 'withdrawn', 'expired'] as const) {
        expect(weaverReviewCopy(fields('merge_approval', {
          status, weaverReviewStatus: 'concerns', weaverReviewedAt: PRIOR, weaverReviewNote: 'needs work',
        }))!.held, status).toBe(false);
      }
    });

    it('is false for unseen and looked, regardless of status', () => {
      expect(weaverReviewCopy(fields('plan_approval', { status: 'open' }))!.held).toBe(false);
      expect(weaverReviewCopy(fields('plan_approval', {
        status: 'open', weaverReviewStatus: 'looked', weaverReviewedAt: PRIOR, weaverReviewNote: 'clean',
      }))!.held).toBe(false);
    });
  });

  it('does not sell a clean review as a sign-off (VS-234)', () => {
    const copy = weaverReviewCopy(fields('plan_approval', {
      weaverReviewStatus: 'looked', weaverReviewedAt: PRIOR, weaverReviewNote: 'migration matches the plan',
    }));
    expect(copy!.line).not.toMatch(/signed off|approved by|✓|✔|✅/i);
    expect(copy!.tone).toBe('looked');
  });

  it('keeps unseen loud, looked understated, concerns loudest', () => {
    expect(weaverReviewCopy(fields('plan_approval'))!.tone).toBe('unseen');
    expect(weaverReviewCopy(fields('plan_approval', {
      weaverReviewStatus: 'looked', weaverReviewedAt: PRIOR,
    }))!.tone).toBe('looked');
    expect(weaverReviewCopy(fields('plan_approval', {
      weaverReviewStatus: 'concerns', weaverReviewedAt: PRIOR, weaverReviewNote: 'x',
    }))!.tone).toBe('concerns');
  });
});
