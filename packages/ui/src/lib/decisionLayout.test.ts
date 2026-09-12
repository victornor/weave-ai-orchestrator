/** Where the weave chat's open decisions render, remembered per device (`lib/decisionLayout.ts`, VS-289). */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDecisionLayout, useDecisionLayout } from './decisionLayout';

const KEY = 'conductor.decisions.layout';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the remembered chat decision layout', () => {
  it('opens on the bottom strip when nothing was remembered', () => {
    expect(readDecisionLayout()).toBe('bottom');
  });

  it('reads back a chosen split', () => {
    localStorage.setItem(KEY, 'split');
    expect(readDecisionLayout()).toBe('split');
  });

  it('reads anything unrecognised as the bottom strip', () => {
    localStorage.setItem(KEY, 'sideways');
    expect(readDecisionLayout()).toBe('bottom');
  });

  it('forgets the key outright when the bottom strip is chosen again', () => {
    const { result } = renderHook(() => useDecisionLayout());
    act(() => result.current[1]('split'));
    expect(localStorage.getItem(KEY)).toBe('split');
    expect(result.current[0]).toBe('split');

    act(() => result.current[1]('bottom'));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current[0]).toBe('bottom');
  });

  it('keeps the session choice when the store cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { result } = renderHook(() => useDecisionLayout());
    act(() => result.current[1]('split'));
    expect(result.current[0]).toBe('split');
  });

  it('shows the bottom strip when the store cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readDecisionLayout()).toBe('bottom');
  });
});
