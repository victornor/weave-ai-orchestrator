/**
 * VS-425: the streaming reveal behind the chat's new replies and the composer's dictated text.
 * The pure progress function, and the hook's three rules — instant when not new, progressive when
 * new, and never restarted by a later `animate` flip.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealedCount, useStreamReveal } from '../lib/streamReveal';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('revealedCount', () => {
  it('is never empty at the first frame, complete at the end, and in between in the middle', () => {
    expect(revealedCount(0, 100, 400)).toBe(0);
    expect(revealedCount(10, 0, 400)).toBe(1);
    expect(revealedCount(10, 400, 400)).toBe(10);
    expect(revealedCount(10, 9999, 400)).toBe(10);
    const mid = revealedCount(100, 200, 400);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(100);
  });

  it('is immediate when there is no duration to fill', () => {
    expect(revealedCount(7, 0, 0)).toBe(7);
  });
});

describe('useStreamReveal', () => {
  it('returns the whole text at once when not animating', () => {
    const { result } = renderHook(() => useStreamReveal('hello there', false));
    expect(result.current).toBe('hello there');
  });

  it('reveals progressively and settles on the whole text', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamReveal('abcdefghij', true, 160));

    expect(result.current.length).toBeLessThan(10);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('abcdefghij');
  });

  it('finishes the reveal it started even if the caller later says not to animate', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ animate }: { animate: boolean }) => useStreamReveal('abcdefghij', animate, 160),
      { initialProps: { animate: true } },
    );

    rerender({ animate: false });
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('abcdefghij');
  });

  it('is instant under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);

    const { result } = renderHook(() => useStreamReveal('abcdefghij', true));
    expect(result.current).toBe('abcdefghij');
  });

  it('follows growth: the visible prefix only lengthens, it never restarts', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ full }: { full: string }) => useStreamReveal(full, true, 160),
      { initialProps: { full: 'abcdefghij' } },
    );

    act(() => { vi.advanceTimersByTime(48); });
    const early = result.current;
    expect(early.length).toBeGreaterThan(0);
    expect(early.length).toBeLessThan(10);

    // The line keeps arriving: the reveal resumes from what is shown, not from the first character.
    rerender({ full: 'abcdefghijklmnopqrst' });
    expect('abcdefghijklmnopqrst'.startsWith(result.current)).toBe(true);
    expect(result.current.length).toBeGreaterThanOrEqual(early.length);

    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current).toBe('abcdefghijklmnopqrst');
  });
});
