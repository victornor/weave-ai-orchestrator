import { describe, expect, it } from 'vitest';
import { PROMOTION_REVIEW_STALE_LINE, promotionCardReview } from './promotion-card.js';

const card = (over: Record<string, unknown> = {}) => ({
  weaverReviewedHeadSha: null,
  weaverReviewStatus: 'looked',
  target: { promotion: { state: 'open', landingHead: null, reviewStale: false } },
  ...over,
}) as never;

describe('promotionCardReview (VS-632)', () => {
  it('reads the daemon flag as stale and names the line', () => {
    const r = promotionCardReview(card({ target: { promotion: { state: 'open', landingHead: 'c17384f9', reviewStale: true } } }));
    expect(r).toMatchObject({ stale: true, line: PROMOTION_REVIEW_STALE_LINE, landingHead: 'c17384f9' });
  });

  it('falls back to comparing the recorded heads when the flag has not been recomputed yet', () => {
    const r = promotionCardReview(card({
      weaverReviewedHeadSha: '8d2051f1',
      target: { promotion: { state: 'open', landingHead: 'c17384f9' } },
    }));
    expect(r.stale).toBe(true);
  });

  it('is not stale while the reviewed head is the landing head', () => {
    const r = promotionCardReview(card({
      weaverReviewedHeadSha: '8d2051f1',
      target: { promotion: { state: 'open', landingHead: '8d2051f1', reviewStale: false } },
    }));
    expect(r).toMatchObject({ stale: false, line: null });
  });

  it('is not stale when the card was never reviewed', () => {
    const r = promotionCardReview(card({ target: { promotion: { state: 'open', landingHead: 'c17384f9', reviewStale: false } } }));
    expect(r.stale).toBe(false);
  });

  it('never reads a concerns mark as stale, whatever the heads say', () => {
    const r = promotionCardReview(card({
      weaverReviewedHeadSha: '8d2051f1',
      weaverReviewStatus: 'concerns',
      target: { promotion: { state: 'open', landingHead: 'c17384f9', reviewStale: true } },
    }));
    expect(r.stale).toBe(false);
  });

  it('reads a malformed or absent target as not stale', () => {
    expect(promotionCardReview(card({ target: null })).stale).toBe(false);
    expect(promotionCardReview(card({ target: { promotion: 'nonsense' } })).stale).toBe(false);
  });
});