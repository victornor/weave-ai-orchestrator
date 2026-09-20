import type { Decision } from './types.js';

/**
 * VS-632: the one line a promotion card shows while its weaver review no longer applies to the
 * landing head the card is about to promote.
 */
export const PROMOTION_REVIEW_STALE_LINE = 'edge moved since the last review; the weaver is re-checking it';

export interface PromotionCardReview {
  /** True while the landing head has moved past the head the weaver reviewed. */
  stale: boolean;
  /** The line to show while stale, null otherwise. */
  line: string | null;
  /** The landing head recorded on the card, if any. */
  landingHead: string | null;
  /** The head the weaver's mark was made against, if any. */
  reviewedHead: string | null;
}

/** Two SHAs name the same object when one is a prefix of the other (mirrors the core helper). */
function sameGitSha(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length < 7 || y.length < 7) return x === y;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/**
 * The held state of an open promotion card. The daemon records `reviewStale` on the card's target
 * each time it refreshes the card, so that flag is authoritative; comparing the recorded heads is a
 * fallback for a card the daemon has not refreshed since the review. A `concerns` mark never reads as
 * stale — it holds the card in its own right and its note must stay visible. Absent or malformed data
 * reads as not stale rather than guessing.
 */
export function promotionCardReview(d: Pick<Decision, 'weaverReviewedHeadSha' | 'weaverReviewStatus' | 'target'>): PromotionCardReview {
  const promotion = d.target && typeof d.target === 'object'
    ? ((d.target as Record<string, unknown>)['promotion'] as Record<string, unknown> | null | undefined)
    : null;
  const landingHead = typeof promotion?.['landingHead'] === 'string' ? (promotion['landingHead'] as string) : null;
  const reviewedHead = d.weaverReviewedHeadSha ?? null;
  const stale = d.weaverReviewStatus !== 'concerns'
    && (promotion?.['reviewStale'] === true
      || (reviewedHead != null && landingHead != null && !sameGitSha(reviewedHead, landingHead)));
  return { stale, line: stale ? PROMOTION_REVIEW_STALE_LINE : null, landingHead, reviewedHead };
}
