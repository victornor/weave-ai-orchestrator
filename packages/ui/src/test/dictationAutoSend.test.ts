/**
 * The per-browser "send automatically when dictation ends" preference (VS-435): off by default,
 * durable across a reload, and published so a composer already mounted follows a change.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDictationAutoSend, useDictationAutoSend, writeDictationAutoSend } from '../lib/dictationAutoSend';

const KEY = 'conductor.dictationAutoSend';

beforeEach(() => {
  localStorage.removeItem(KEY);
});

afterEach(() => {
  localStorage.removeItem(KEY);
});

describe('dictation auto-send preference (VS-435)', () => {
  it('defaults to off, read and mounted alike', () => {
    expect(readDictationAutoSend()).toBe(false);
    const { result } = renderHook(() => useDictationAutoSend());
    expect(result.current).toBe(false);
  });

  it('persists what is written', () => {
    writeDictationAutoSend(true);
    expect(readDictationAutoSend()).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('on');

    writeDictationAutoSend(false);
    expect(readDictationAutoSend()).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('off');
  });

  it('updates a mounted reader live, without a reload', () => {
    const { result } = renderHook(() => useDictationAutoSend());
    expect(result.current).toBe(false);

    act(() => writeDictationAutoSend(true));
    expect(result.current).toBe(true);
  });
});
