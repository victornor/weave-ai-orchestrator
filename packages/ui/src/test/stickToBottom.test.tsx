/**
 * VS-425: the `exact` follow added to `useStickToBottom` — "the bottom" is the scroll element's own
 * `scrollHeight - clientHeight`, not a sentinel's position, and the follow is a rAF loop that keeps
 * landing there while content grows. The V1 sentinel path is covered by `chat.test.tsx`.
 *
 * jsdom does no layout and never scrolls, so the element's geometry is staged and
 * `requestAnimationFrame` is driven by hand — the same technique the follow suite in `chat.test.tsx`
 * uses for `scrollIntoView`.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStickToBottom } from '../lib/stickToBottom';
import { resizeObserved } from './resizeObserver';

const CLIENT = 300;

function scroller(height: number) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let scrollHeight = height;
  let top = 0;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => CLIENT });
  // Clamped the way a real scroll container clamps: assigning past the maximum lands on it. The
  // follow's final write is `scrollHeight`, so the fake must clamp for that to mean the bottom.
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = Math.max(0, Math.min(v, scrollHeight - CLIENT)); },
  });
  return {
    el,
    grow: (by: number): void => { scrollHeight += by; },
    setTop: (v: number): void => { top = v; },
    get top(): number { return top; },
    bottom: (): number => scrollHeight - CLIENT,
  };
}

/** Frames queued by the hook, run one `act` at a time so React flushes each step. */
let frames: FrameRequestCallback[] = [];

function runFrames(max = 500): number {
  let ran = 0;
  while (frames.length && ran < max) {
    const cb = frames.shift()!;
    act(() => { cb(0); });
    ran += 1;
  }
  return ran;
}

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mount(initial: readonly unknown[]) {
  const hook = renderHook(
    ({ signal }: { signal: readonly unknown[] }) => useStickToBottom(signal, { exact: true }),
    { initialProps: { signal: initial } },
  );
  return hook;
}

describe('the exact follow', () => {
  it('settles exactly on the true bottom, not the padded sentinel position', () => {
    const s = scroller(1000);
    const { result, rerender } = mount([0]);
    act(() => result.current.scrollRef(s.el));

    rerender({ signal: [1] });
    runFrames();

    expect(s.top).toBe(s.bottom());
  });

  it('keeps landing on the bottom while the content grows mid-follow', () => {
    const s = scroller(1000);
    const { result, rerender } = mount([0]);
    act(() => result.current.scrollRef(s.el));

    rerender({ signal: [1] });
    runFrames();
    expect(s.top).toBe(1000 - CLIENT);

    // The rendered message grows after the follow already scrolled to it (a streaming reveal, an
    // image, a code block): the geometry observer re-targets, and the loop reaches the new bottom.
    s.grow(260);
    act(() => resizeObserved());
    runFrames();

    expect(s.top).toBe(1260 - CLIENT);
  });

  it('does not move a list the human has scrolled up from, and marks it unread', () => {
    const s = scroller(1000);
    const { result, rerender } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    // Down to the bottom first, so an upward move is recognisable to the scroll listener.
    act(() => { s.setTop(s.bottom()); s.el.dispatchEvent(new Event('scroll')); });
    act(() => { s.setTop(120); s.el.dispatchEvent(new Event('scroll')); });
    expect(result.current.atBottom).toBe(false);

    rerender({ signal: [1] });
    act(() => { resizeObserved(); });
    runFrames();

    expect(s.top).toBe(120);
    expect(result.current.unread).toBe(true);
  });

  it('jumps without animating under reduced motion', () => {
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
    const s = scroller(1000);
    const { result, rerender } = mount([0]);
    act(() => result.current.scrollRef(s.el));

    rerender({ signal: [1] });

    expect(s.top).toBe(1000 - CLIENT);
    expect(frames).toHaveLength(0);
  });

  it('returns to the bottom and follows again when asked', () => {
    const s = scroller(1000);
    const { result, rerender } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    act(() => { s.setTop(s.bottom()); s.el.dispatchEvent(new Event('scroll')); });
    act(() => { s.setTop(120); s.el.dispatchEvent(new Event('scroll')); });

    act(() => result.current.toBottom());
    runFrames();
    expect(s.top).toBe(s.bottom());
    expect(result.current.atBottom).toBe(true);

    s.grow(200);
    rerender({ signal: [1] });
    runFrames();
    expect(s.top).toBe(1200 - CLIENT);
  });
});
