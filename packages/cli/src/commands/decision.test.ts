/**
 * `--override-hold <reason>` (VS-266, VS-281): a distinct, deliberate pair, only meaningful on a
 * decision the card model itself reports as held — under a concern or pending review.
 */
import { describe, expect, it } from 'vitest';
import { refuseInputAnswer, resolveOverrideHold } from './decision.js';

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

// VS-342: a card carrying inputs is answered on its web card, never from the CLI.
describe('refuseInputAnswer', () => {
  it('refuses a decision carrying inputs and names the web card', () => {
    expect(() => refuseInputAnswer('dec_1', {
      inputs: [{ key: 'served', label: 'How is V2 served', type: 'single_choice', choices: [{ key: 'same', label: 'Same app' }, { key: 'sep', label: 'Separate' }] }],
    })).toThrow(/answer it on its card in the web app/);
  });

  it('allows a decision with no inputs', () => {
    expect(() => refuseInputAnswer('dec_1', { inputs: [] })).not.toThrow();
  });
});
