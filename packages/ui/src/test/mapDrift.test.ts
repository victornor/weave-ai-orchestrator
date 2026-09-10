/** VS-192: bounded per-node drift for the global Map. */
import { describe, expect, it } from 'vitest';
import { amplitudeFor, driftOffset, driftPhase } from '../lib/map/drift';

describe('driftPhase', () => {
  it('is deterministic for the same id', () => {
    expect(driftPhase('ticket:t1')).toEqual(driftPhase('ticket:t1'));
  });

  it('differs across ids (not a constant)', () => {
    const a = driftPhase('ticket:t1');
    const b = driftPhase('ticket:t2');
    expect(a.phase === b.phase && a.freqScale === b.freqScale).toBe(false);
  });
});

describe('amplitudeFor', () => {
  it('falls back to the depth base when no sibling gap is known', () => {
    expect(amplitudeFor(2)).toBeGreaterThan(0);
  });

  it('is capped by a tight sibling gap', () => {
    expect(amplitudeFor(2, 1)).toBeLessThanOrEqual(0.2 * 1 + 1e-9);
  });

  it('is zero at the unrendered root depth', () => {
    expect(amplitudeFor(0)).toBe(0);
  });
});

describe('driftOffset', () => {
  it('never exceeds the amplitude in combined magnitude, over a full period', () => {
    const cap = 5;
    let max = 0;
    for (let t = 0; t < 200000; t += 137) {
      const { dx, dy } = driftOffset('ticket:t1', 3, t, cap * (1 / 0.2));
      max = Math.max(max, Math.hypot(dx, dy));
    }
    expect(max).toBeLessThanOrEqual(cap + 1e-6);
  });

  it('is the zero vector once amplitude is capped to zero', () => {
    expect(driftOffset('ticket:t1', 3, 1000, 0)).toEqual({ dx: 0, dy: 0 });
  });
});
