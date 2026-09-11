import { CONDUCTOR_REVIEW_KINDS, type ConductorReviewStatus, type DecisionKind } from './enums.js';
import type { Decision } from './types.js';

/** Cap on `conductorReviewNote` — the concern summary or the clean mark's reason (VS-223, VS-234) — so it fits a phone card. Longer argument is an `ac_ask`. */
export const CONDUCTOR_REVIEW_NOTE_MAX = 500;

export type ConductorReviewCopy = {
  line: string;
  note: string | null;
  tone: 'unseen' | 'looked' | 'concerns' | 'after';
  /**
   * VS-266: true exactly when this decision's approving answer is currently refused — a `concerns`
   * mark on a still-`open` decision. False for every other state, including an `answered`/
   * `superseded`/`withdrawn`/`expired` decision that carries a `concerns` mark: there is nothing
   * left to approve on those, for reasons unrelated to this hold.
   */
  held: boolean;
};

export type ConductorReviewFields = Pick<
  Decision,
  'kind' | 'status' | 'conductorReviewStatus' | 'conductorReviewedAt' | 'conductorReviewNote' | 'answeredAt'
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
  const reviewStatus: ConductorReviewStatus = d.conductorReviewStatus ?? 'unseen';
  const after = reviewIsAfterAnswer(d);
  if (reviewStatus === 'unseen') {
    return { line: "Conductor hasn't reviewed yet", note: null, tone: 'unseen', held: false };
  }
  if (reviewStatus === 'looked') {
    // VS-234: the line states the outcome, the required note carries the reasoning. Marks made
    // before notes were required have none — the line still renders, nothing fills its place.
    return {
      line: after ? 'Conductor reviewed after you answered — no concerns' : 'Conductor reviewed — no concerns',
      note: d.conductorReviewNote ?? null,
      tone: after ? 'after' : 'looked',
      held: false,
    };
  }
  return {
    line: after ? 'Conductor reviewed after you answered — has concerns' : 'Conductor reviewed — has concerns',
    note: d.conductorReviewNote ?? null,
    tone: 'concerns',
    // VS-266: only an open decision is still waiting on an answer at all — held is moot once it is
    // answered, superseded, withdrawn or expired.
    held: d.status === 'open',
  };
}
