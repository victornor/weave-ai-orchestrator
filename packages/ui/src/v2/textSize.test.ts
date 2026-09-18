/** The text-size preference (VS-551): the ladder, the device storage key and the one-source hook. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_SIZE, TEXT_SIZE_STEPS, readTextSize, useTextSize, writeTextSize } from './textSize';

describe('the text-size preference', () => {
  afterEach(() => localStorage.clear());

  it('defaults to the designed size, and treats junk as the default', () => {
    expect(readTextSize()).toBe(DEFAULT_TEXT_SIZE);
    localStorage.setItem('weave.v2.textSize', 'huge');
    expect(readTextSize()).toBe(DEFAULT_TEXT_SIZE);
  });

  it('round-trips every step under the device key', () => {
    for (const step of TEXT_SIZE_STEPS) {
      writeTextSize(step.key);
      expect(readTextSize()).toBe(step.key);
    }
    expect(localStorage.getItem('weave.v2.textSize')).toBe(TEXT_SIZE_STEPS.at(-1)!.key);
  });

  it('updates a mounted reader when the choice changes', () => {
    const { result } = renderHook(() => useTextSize());
    expect(result.current.size).toBe(DEFAULT_TEXT_SIZE);
    act(() => result.current.setSize('lg'));
    expect(result.current.size).toBe('lg');
    expect(readTextSize()).toBe('lg');
  });
});
