import { WEAVER_REVIEW_KINDS, type WeaverReviewStatus, type DecisionKind } from './enums.js';
import type { Decision } from './types.js';

/** Cap on `weaverReviewNote` — the concern summary or the clean mark's reason (VS-223, VS-234) — so it fits a phone card. Longer argument is an `ac_ask`. */
export const WEAVER_REVIEW_NOTE_MAX = 500;

export type WeaverReviewCopy = {
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

export type WeaverReviewFields = Pick<
  Decision,
  'kind' | 'status' | 'weaverReviewStatus' | 'weaverReviewedAt' | 'weaverReviewNote' | 'answeredAt'
>;

/** Plan, merge and action cards carry the state; every other kind returns null from `weaverReviewCopy`. */
export function carriesWeaverReview(kind: DecisionKind): boolean {
  return (WEAVER_REVIEW_KINDS as readonly string[]).includes(kind);
}

/**
 * After-the-fact honesty (VS-223): both timestamps set and the mark is strictly later.
 * Same-millisecond reads as prior, which is the honest same-tick case.
 */
export function reviewIsAfterAnswer(d: Pick<Decision, 'weaverReviewedAt' | 'answeredAt'>): boolean {
  return d.weaverReviewedAt != null && d.answeredAt != null && d.weaverReviewedAt > d.answeredAt;
}

/**
 * One copy table for web DecisionCard and `decisionToCard` (VS-114). Returns `null` only for kinds
 * that do not carry the state. A carrying kind always returns a non-empty `line` — quiet means
 * dimmer type, not missing type.
 */
export function weaverReviewCopy(d: WeaverReviewFields): WeaverReviewCopy | null {
  if (!carriesWeaverReview(d.kind)) return null;
  const reviewStatus: WeaverReviewStatus = d.weaverReviewStatus ?? 'unseen';
  const after = reviewIsAfterAnswer(d);
  if (reviewStatus === 'unseen') {
    return { line: "Weaver hasn't reviewed yet", note: null, tone: 'unseen', held: false };
  }
  if (reviewStatus === 'looked') {
    // VS-234: the line states the outcome, the required note carries the reasoning. Marks made
    // before notes were required have none — the line still renders, nothing fills its place.
    return {
      line: after ? 'Weaver reviewed after you answered — no concerns' : 'Weaver reviewed — no concerns',
      note: d.weaverReviewNote ?? null,
      tone: after ? 'after' : 'looked',
      held: false,
    };
  }
  return {
    line: after ? 'Weaver reviewed after you answered — has concerns' : 'Weaver reviewed — has concerns',
    note: d.weaverReviewNote ?? null,
    tone: 'concerns',
    // VS-266: only an open decision is still waiting on an answer at all — held is moot once it is
    // answered, superseded, withdrawn or expired.
    held: d.status === 'open',
  };
}
