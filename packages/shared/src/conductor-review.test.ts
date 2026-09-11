import { describe, expect, it } from 'vitest';
import { EVENT_TYPES } from './events.js';
import {
  CONDUCTOR_REVIEW_KINDS,
  CONDUCTOR_REVIEW_STATUSES,
  type DecisionKind,
} from './enums.js';
import { conductorReviewCopy, reviewIsAfterAnswer, type ConductorReviewFields } from './conductor-review.js';

const PRIOR = '2026-09-11T02:54:00.000Z';
const LATER = '2026-09-11T02:56:00.000Z';

function fields(
  kind: DecisionKind,
  over: Partial<ConductorReviewFields> = {},
): ConductorReviewFields {
  return {
    kind,
    conductorReviewStatus: 'unseen',
    conductorReviewedAt: null,
    conductorReviewNote: null,
    answeredAt: null,
    ...over,
  };
}

describe('CONDUCTOR_REVIEW_STATUSES (VS-223)', () => {
  it('is unseen, looked, concerns', () => {
    expect(CONDUCTOR_REVIEW_STATUSES).toEqual(['unseen', 'looked', 'concerns']);
  });
});

describe('EVENT_TYPES (VS-223)', () => {
  it('includes decision.updated', () => {
    expect(EVENT_TYPES).toContain('decision.updated');
  });
});

describe('reviewIsAfterAnswer', () => {
  it('is true only when reviewedAt is strictly later than answeredAt', () => {
    expect(reviewIsAfterAnswer({ answeredAt: PRIOR, conductorReviewedAt: LATER })).toBe(true);
    expect(reviewIsAfterAnswer({ answeredAt: LATER, conductorReviewedAt: PRIOR })).toBe(false);
    expect(reviewIsAfterAnswer({ answeredAt: PRIOR, conductorReviewedAt: PRIOR })).toBe(false);
    expect(reviewIsAfterAnswer({ answeredAt: null, conductorReviewedAt: LATER })).toBe(false);
    expect(reviewIsAfterAnswer({ answeredAt: PRIOR, conductorReviewedAt: null })).toBe(false);
    expect(reviewIsAfterAnswer({ answeredAt: null, conductorReviewedAt: null })).toBe(false);
  });
});

describe('conductorReviewCopy', () => {
  it('returns null only for kinds that do not carry the state', () => {
    expect(conductorReviewCopy(fields('question'))).toBeNull();
    expect(conductorReviewCopy(fields('hire_approval'))).toBeNull();
    expect(conductorReviewCopy(fields('retry_approval'))).toBeNull();
    expect(conductorReviewCopy(fields('concern'))).toBeNull();
    expect(conductorReviewCopy(fields('discard_approval'))).toBeNull();
  });

  const timings = [
    { name: 'open', answeredAt: null as string | null, reviewedAt: null as string | null },
    { name: 'answered-prior', answeredAt: LATER, reviewedAt: PRIOR },
    { name: 'answered-after', answeredAt: PRIOR, reviewedAt: LATER },
  ] as const;

  it.each(CONDUCTOR_REVIEW_KINDS)('%s always returns a non-empty line in every status and timing', (kind) => {
    for (const status of CONDUCTOR_REVIEW_STATUSES) {
      for (const t of timings) {
        const copy = conductorReviewCopy(fields(kind, {
          conductorReviewStatus: status,
          conductorReviewedAt: status === 'unseen' ? null : t.reviewedAt,
          conductorReviewNote: status === 'concerns' ? 'the migration contradicts itself' : null,
          answeredAt: t.answeredAt,
        }));
        expect(copy, `${kind} ${status} ${t.name}`).not.toBeNull();
        expect(copy!.line.length, `${kind} ${status} ${t.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('uses the exact unanswered and after-the-fact copy', () => {
    expect(conductorReviewCopy(fields('plan_approval'))).toEqual({
      line: "Conductor hasn't looked yet", note: null, tone: 'unseen',
    });
    expect(conductorReviewCopy(fields('merge_approval', {
      conductorReviewStatus: 'looked', conductorReviewedAt: PRIOR,
    }))).toEqual({ line: 'Conductor looked', note: null, tone: 'looked' });
    expect(conductorReviewCopy(fields('action_approval', {
      conductorReviewStatus: 'looked', conductorReviewedAt: LATER, answeredAt: PRIOR,
    }))).toEqual({ line: 'Conductor looked after you answered', note: null, tone: 'after' });
    expect(conductorReviewCopy(fields('plan_approval', {
      conductorReviewStatus: 'concerns', conductorReviewedAt: PRIOR,
      conductorReviewNote: 'split the migration',
    }))).toEqual({
      line: 'Conductor looked — has concerns', note: 'split the migration', tone: 'concerns',
    });
    expect(conductorReviewCopy(fields('merge_approval', {
      conductorReviewStatus: 'concerns', conductorReviewedAt: LATER, answeredAt: PRIOR,
      conductorReviewNote: 'CI is red',
    }))).toEqual({
      line: 'Conductor looked after you answered — has concerns', note: 'CI is red', tone: 'concerns',
    });
  });

  it('does not sell a clean look as a sign-off', () => {
    const copy = conductorReviewCopy(fields('plan_approval', {
      conductorReviewStatus: 'looked', conductorReviewedAt: PRIOR,
    }));
    expect(copy!.line).not.toMatch(/signed off|approved by|✓|✔|✅/i);
    expect(copy!.tone).toBe('looked');
  });

  it('keeps unseen loud, looked understated, concerns loudest', () => {
    expect(conductorReviewCopy(fields('plan_approval'))!.tone).toBe('unseen');
    expect(conductorReviewCopy(fields('plan_approval', {
      conductorReviewStatus: 'looked', conductorReviewedAt: PRIOR,
    }))!.tone).toBe('looked');
    expect(conductorReviewCopy(fields('plan_approval', {
      conductorReviewStatus: 'concerns', conductorReviewedAt: PRIOR, conductorReviewNote: 'x',
    }))!.tone).toBe('concerns');
  });
});
