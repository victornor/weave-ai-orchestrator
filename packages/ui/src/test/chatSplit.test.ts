/**
 * VS-829: the conversation's reading measure (`v2/chatSplit.ts`, `conversationMeasure`) and the two
 * places that apply it — the composer wrapper and the message column — which must always carry the
 * same number, so a wide pane is used instead of centring a 720px strip in it.
 */
import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_MAX_WIDTH,
  CONVERSATION_READING_WIDTH,
  CONVERSATION_WIDEN_AT,
  conversationMeasure,
} from '../v2/chatSplit';

describe('conversationMeasure', () => {
  it('keeps the reading width at and below the widening threshold', () => {
    for (const width of [0, 320, 620, 900, 1280, 1500, CONVERSATION_WIDEN_AT]) {
      expect(conversationMeasure(width), `at ${width}`).toBe(CONVERSATION_READING_WIDTH);
    }
  });

  it('widens with the region once past the threshold', () => {
    expect(conversationMeasure(CONVERSATION_WIDEN_AT + 1)).toBeGreaterThan(CONVERSATION_READING_WIDTH);
    // 2560 * 0.75 is 1920, past the maximum, so a full-width pane still clamps.
    expect(conversationMeasure(2560)).toBe(CONVERSATION_MAX_WIDTH);
    expect(conversationMeasure(1800)).toBe(1350);
  });

  it('never divides the region by two: a half of a 5120px window clears the reading width by a lot', () => {
    const halfOf5120 = 5120 / 2;
    expect(conversationMeasure(halfOf5120)).toBe(CONVERSATION_MAX_WIDTH);
    expect(conversationMeasure(halfOf5120)).toBeGreaterThan(CONVERSATION_READING_WIDTH * 2);
  });

  it('clamps at the maximum so a line of prose never gets longer', () => {
    expect(conversationMeasure(3840)).toBe(CONVERSATION_MAX_WIDTH);
    expect(conversationMeasure(5120)).toBe(CONVERSATION_MAX_WIDTH);
    expect(conversationMeasure(100000)).toBe(CONVERSATION_MAX_WIDTH);
  });

  it('is monotone and integer-valued across the whole range', () => {
    let previous = 0;
    for (let width = 0; width <= 5120; width += 37) {
      const measure = conversationMeasure(width);
      expect(Number.isInteger(measure)).toBe(true);
      expect(measure).toBeGreaterThanOrEqual(previous);
      expect(measure).toBeGreaterThanOrEqual(CONVERSATION_READING_WIDTH);
      expect(measure).toBeLessThanOrEqual(CONVERSATION_MAX_WIDTH);
      previous = measure;
    }
  });

  it('treats an unmeasured or non-finite region as narrow', () => {
    expect(conversationMeasure(Number.NaN)).toBe(CONVERSATION_READING_WIDTH);
    expect(conversationMeasure(Number.POSITIVE_INFINITY)).toBe(CONVERSATION_READING_WIDTH);
  });
});
