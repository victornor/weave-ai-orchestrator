/**
 * `--override-hold <reason>` (VS-266, VS-281): a distinct, deliberate pair, only meaningful on a
 * decision the card model itself reports as held — under a concern or pending review.
 */
import { describe, expect, it } from 'vitest';
import { resolveOverrideHold } from './decision.js';

describe('resolveOverrideHold', () => {
  it('is undefined when no reason is given', () => {
    expect(resolveOverrideHold({ id: 'dec_1', held: true, awaitsReview: false }, undefined)).toBeUndefined();
    expect(resolveOverrideHold({ id: 'dec_1', held: false, awaitsReview: true }, undefined)).toBeUndefined();
    expect(resolveOverrideHold({ id: 'dec_1', held: false, awaitsReview: false }, undefined)).toBeUndefined();
  });

  it('returns the override pair when the card is held under a concern', () => {
    expect(resolveOverrideHold({ id: 'dec_1', held: true, awaitsReview: false }, 'acceptable risk, ship it')).toEqual({
      overrideHold: true, overrideReason: 'acceptable risk, ship it',
    });
  });

  it('returns the override pair when the card is awaiting the weaver review', () => {
    expect(resolveOverrideHold({ id: 'dec_1', held: false, awaitsReview: true }, 'reviewed it myself')).toEqual({
      overrideHold: true, overrideReason: 'reviewed it myself',
    });
  });

  it('refuses a reason on a decision that is not held', () => {
    expect(() => resolveOverrideHold({ id: 'dec_1', held: false, awaitsReview: false }, 'not needed')).toThrow(/is not held/);
  });
});
