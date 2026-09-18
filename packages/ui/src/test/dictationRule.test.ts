/**
 * VS-439, VS-552: the one shared rule that drops a dictation below three words. Both composers and
 * the decision cards funnel through `isDictationTooShort`, so this is the single place its counting
 * is pinned.
 */
import { describe, expect, it } from 'vitest';
import { DICTATION_MIN_WORDS, isDictationTooShort } from '../lib/dictation';

describe('the dictation length rule (VS-439, VS-552)', () => {
  it('inserts three words and discards two', () => {
    expect(DICTATION_MIN_WORDS).toBe(3);
    expect(isDictationTooShort('yes do that')).toBe(false);
    expect(isDictationTooShort('one two')).toBe(true);
  });

  it('counts a token only when it holds a letter or a digit', () => {
    // Two words plus punctuation-only tokens: still two words, so still discarded.
    expect(isDictationTooShort('one two — … “')).toBe(true);
    expect(isDictationTooShort('one two three — …')).toBe(false);
    // Nothing but punctuation is no words at all.
    expect(isDictationTooShort('… — ... !?')).toBe(true);
    // Digits count, and a token with letters among punctuation still counts once.
    expect(isDictationTooShort('1 2 —')).toBe(true);
    expect(isDictationTooShort('1 2 3 —')).toBe(false);
    expect(isDictationTooShort("don't stop, now go")).toBe(false);
  });

  it('collapses whitespace and ignores an empty result', () => {
    expect(isDictationTooShort('')).toBe(true);
    expect(isDictationTooShort('   \n\t ')).toBe(true);
    expect(isDictationTooShort('  one   two ')).toBe(true);
    expect(isDictationTooShort('  one   two  three ')).toBe(false);
  });
});
