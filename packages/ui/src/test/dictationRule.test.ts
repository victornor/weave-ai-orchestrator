/**
 * VS-439: the one shared rule that drops a dictation of five words or fewer. Both composers funnel
 * through `isDictationTooShort`, so this is the single place its counting is pinned.
 */
import { describe, expect, it } from 'vitest';
import { DICTATION_MIN_WORDS, isDictationTooShort } from '../lib/dictation';

describe('the dictation length rule (VS-439)', () => {
  it('keeps six words and discards five', () => {
    expect(DICTATION_MIN_WORDS).toBe(6);
    expect(isDictationTooShort('one two three four five')).toBe(true);
    expect(isDictationTooShort('one two three four five six')).toBe(false);
  });

  it('counts a token only when it holds a letter or a digit', () => {
    // Five words plus punctuation-only tokens: still five words, so still discarded.
    expect(isDictationTooShort('one two three four five — … “')).toBe(true);
    expect(isDictationTooShort('one two three four five six — …')).toBe(false);
    // Nothing but punctuation is no words at all.
    expect(isDictationTooShort('… — ... !?')).toBe(true);
    // Digits count, and a token with letters among punctuation still counts once.
    expect(isDictationTooShort('1 2 3 4 5 —')).toBe(true);
    expect(isDictationTooShort("don't stop, don't stop, now go")).toBe(false);
  });

  it('collapses whitespace and ignores an empty result', () => {
    expect(isDictationTooShort('')).toBe(true);
    expect(isDictationTooShort('   \n\t ')).toBe(true);
    expect(isDictationTooShort('  one   two  three four five six ')).toBe(false);
  });
});