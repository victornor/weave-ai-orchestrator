import { CONDUCTOR_REVIEW_KINDS, type ConductorReviewStatus, type DecisionKind } from './enums.js';
import type { Decision } from './types.js';

/** Cap on `conductorReviewNote` so a concern fits a phone card (VS-223). Longer argument is an `ac_ask`. */
export const CONDUCTOR_REVIEW_NOTE_MAX = 500;

export type ConductorReviewCopy = {
  line: string;
  note: string | null;
  tone: 'unseen' | 'looked' | 'concerns' | 'after';
};

export type ConductorReviewFields = Pick<
  Decision,
  'kind' | 'conductorReviewStatus' | 'conductorReviewedAt' | 'conductorReviewNote' | 'answeredAt'
>;

/** Plan, merge and action cards carry the state; every other kind returns null from `conductorReviewCopy`. */
export function carriesConductorReview(kind: DecisionKind): boolean {
  return (CONDUCTOR_REVIEW_KINDS as readonly string[]).includes(kind);
}

/**
 * After-the-fact honesty (VS-223): both timestamps set and the mark is strictly later.
 * Same-millisecond reads as prior, which is the honest same-tick case.
 */
export function reviewIsAfterAnswer(d: Pick<Decision, 'conductorReviewedAt' | 'answeredAt'>): boolean {
  return d.conductorReviewedAt != null && d.answeredAt != null && d.conductorReviewedAt > d.answeredAt;
}

/**
 * One copy table for web DecisionCard and `decisionToCard` (VS-114). Returns `null` only for kinds
 * that do not carry the state. A carrying kind always returns a non-empty `line` — quiet means
 * dimmer type, not missing type.
 */
export function conductorReviewCopy(d: ConductorReviewFields): ConductorReviewCopy | null {
  if (!carriesConductorReview(d.kind)) return null;
  const status: ConductorReviewStatus = d.conductorReviewStatus ?? 'unseen';
  const after = reviewIsAfterAnswer(d);
  if (status === 'unseen') {
    return { line: "Conductor hasn't looked yet", note: null, tone: 'unseen' };
  }
  if (status === 'looked') {
    return {
      line: after ? 'Conductor looked after you answered' : 'Conductor looked',
      note: null,
      tone: after ? 'after' : 'looked',
    };
  }
  return {
    line: after ? 'Conductor looked after you answered — has concerns' : 'Conductor looked — has concerns',
    note: d.conductorReviewNote ?? null,
    tone: 'concerns',
  };
}
