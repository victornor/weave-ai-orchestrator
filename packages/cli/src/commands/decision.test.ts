/**
 * `--override-hold <reason>` (VS-266): a distinct, deliberate pair, only meaningful on a decision
 * the card model itself reports as held.
 */
import { describe, expect, it } from 'vitest';
import { resolveOverrideHold } from './decision.js';

describe('resolveOverrideHold', () => {
  it('is undefined when no reason is given', () => {
    expect(resolveOverrideHold({ id: 'dec_1', held: true }, undefined)).toBeUndefined();
    expect(resolveOverrideHold({ id: 'dec_1', held: false }, undefined)).toBeUndefined();
  });

  it('returns the override pair when the card is held', () => {
    expect(resolveOverrideHold({ id: 'dec_1', held: true }, 'acceptable risk, ship it')).toEqual({
      overrideHold: true, overrideReason: 'acceptable risk, ship it',
    });
  });

  it('refuses a reason on a decision that is not held', () => {
    expect(() => resolveOverrideHold({ id: 'dec_1', held: false }, 'not needed')).toThrow(/is not held/);
  });
});
