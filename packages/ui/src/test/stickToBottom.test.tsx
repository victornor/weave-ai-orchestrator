/**
 * VS-425: the `exact` follow added to `useStickToBottom` — "the bottom" is the scroll element's own
 * `scrollHeight - clientHeight`, not a sentinel's position, and the follow is a rAF loop that keeps
 * landing there while content grows. The V1 sentinel path is covered by `chat.test.tsx`.
 * VS-451: only a scroll the human made pauses the follow. A wheel, touch or scroll key pauses; a
 * scroll the browser makes on its own — content shrinking under a clamped list, an older page, the
 * composer growing so the list gets shorter — never does.
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
  let clientHeight = CLIENT;
  let top = 0;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  // Clamped the way a real scroll container clamps: assigning past the maximum lands on it. The
  // follow's final write is `scrollHeight`, so the fake must clamp for that to mean the bottom.
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = Math.max(0, Math.min(v, scrollHeight - clientHeight)); },
  });
  return {
    el,
    grow: (by: number): void => { scrollHeight += by; },
    /**
     * The list gets shorter because something below it grew — the composer on the V2 chat. The
     * browser clamps a list at its end down to the new, smaller maximum, which is the scroll event
     * the fix must not read as an upward scroll.
     */
    shrinkClient: (by: number): void => {
      clientHeight -= by;
      top = Math.max(0, Math.min(top, scrollHeight - clientHeight));
    },
    scroll: (): void => { el.dispatchEvent(new Event('scroll')); },
    wheelUp: (): void => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 })); },
    touchStart: (): void => { el.dispatchEvent(new Event('touchstart')); },
    setTop: (v: number): void => { top = v; },
    get top(): number { return top; },
    bottom: (): number => scrollHeight - clientHeight,
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

/** A scroll key pressed on `target`; it bubbles the way a real keydown from a focused element does. */
function press(key: string, target: EventTarget = document.body): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
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

  it('does not move a list the human has scrolled up from with a wheel, and marks it unread', () => {
    const s = scroller(1000);
    const { result, rerender } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    // Down to the bottom first, so an upward move is recognisable to the scroll listener.
    act(() => { s.setTop(s.bottom()); s.scroll(); });
    act(() => { s.wheelUp(); s.setTop(120); s.scroll(); });
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
    act(() => { s.setTop(s.bottom()); s.scroll(); });
    act(() => { s.wheelUp(); s.setTop(120); s.scroll(); });

    act(() => result.current.toBottom());
    runFrames();
    expect(s.top).toBe(s.bottom());
    expect(result.current.atBottom).toBe(true);

    s.grow(200);
    rerender({ signal: [1] });
    runFrames();
    expect(s.top).toBe(1200 - CLIENT);
  });

  it('the follow’s own downward frames inside the gesture window do not pause it (VS-451)', () => {
    const s = scroller(1000);
    const { result } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    act(() => { s.setTop(s.bottom()); s.scroll(); });
    act(() => { s.wheelUp(); s.setTop(120); s.scroll(); });
    expect(result.current.following.current).toBe(false);

    // The human asks for the bottom again; the rAF follow moves down, and a frame short of the
    // bottom arrives while the wheel is still in the gesture window. Only an *upward* move can
    // pause, or our own follow would stop itself the instant it resumed.
    act(() => result.current.toBottom());
    act(() => { s.setTop(400); s.scroll(); });
    expect(result.current.following.current).toBe(true);
    runFrames();
    expect(s.top).toBe(s.bottom());
  });

  it('a touch upward scroll pauses the follow (VS-451)', () => {
    const s = scroller(1000);
    const { result } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    act(() => { s.setTop(s.bottom()); s.scroll(); });

    act(() => { s.touchStart(); s.setTop(150); s.scroll(); });
    expect(result.current.atBottom).toBe(false);
    expect(result.current.following.current).toBe(false);
  });

  it('a scroll with no gesture behind it never pauses, so growth and reflow keep following (VS-451)', () => {
    const s = scroller(1000);
    const { result, rerender } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    rerender({ signal: [1] });
    runFrames();
    expect(s.top).toBe(s.bottom());

    // Content shrinking under a list clamped at its end: the browser lowers `scrollTop` with no
    // input, and that must not be read as the human scrolling up.
    act(() => { s.shrinkClient(200); s.scroll(); });
    expect(result.current.following.current).toBe(true);
    expect(result.current.atBottom).toBe(true);

    // The geometry observer then re-pins to the new true bottom.
    act(() => { resizeObserved(); });
    runFrames();
    expect(s.top).toBe(s.bottom());

    // And a later growing reply is still followed.
    s.grow(300);
    rerender({ signal: [2] });
    runFrames();
    expect(s.top).toBe(s.bottom());
  });

  it('a prepended older page does not pause the follow (VS-451)', () => {
    const s = scroller(1000);
    const { result } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    act(() => { s.setTop(s.bottom()); s.scroll(); });

    // An older page is prepended: the content is taller, and the browser's anchoring moves the
    // list down with it. Neither is the human.
    act(() => { s.grow(500); s.scroll(); });
    expect(result.current.following.current).toBe(true);
  });

  it('a scrollbar drag on the scroller pauses, but a click on its content does not (VS-451)', () => {
    const s = scroller(1000);
    const { result } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    act(() => { s.setTop(s.bottom()); s.scroll(); });

    // A click on a message bubbles to the scroller but starts on the message, not the scroller, so
    // it must not arm the pause: an unrelated reflow could then be mistaken for the human.
    const child = document.createElement('div');
    s.el.appendChild(child);
    act(() => { child.dispatchEvent(new Event('pointerdown', { bubbles: true })); window.dispatchEvent(new Event('pointerup')); s.setTop(120); s.scroll(); });
    expect(result.current.following.current).toBe(true);

    // A drag that started on the scroller itself — its scrollbar — is the human.
    act(() => { s.el.dispatchEvent(new Event('pointerdown')); });
    act(() => { s.setTop(60); s.scroll(); });
    expect(result.current.following.current).toBe(false);
    act(() => { window.dispatchEvent(new Event('pointerup')); });
  });

  it('a scroll key pressed on the body pauses the follow, though no keydown reaches the scroller (VS-460)', () => {
    const s = scroller(1000);
    const { result } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    act(() => { s.setTop(s.bottom()); s.scroll(); });

    // The browser routes PageUp to the nearest scrollable, but the event target is the body: the
    // old scroller-local listener never saw it, so the move below read as a gestureless reflow.
    act(() => { press('PageUp'); s.setTop(120); s.scroll(); });
    expect(result.current.atBottom).toBe(false);
    expect(result.current.following.current).toBe(false);
  });

  it('a scroll key on a control outside the scroller pauses the follow (VS-460)', () => {
    const s = scroller(1000);
    const { result } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    act(() => { s.setTop(s.bottom()); s.scroll(); });

    const link = document.createElement('button');
    document.body.appendChild(link);

    act(() => { press('ArrowUp', link); s.setTop(140); s.scroll(); });
    expect(result.current.following.current).toBe(false);
  });

  it('a scroll key that edits text never pauses the follow (VS-460)', () => {
    const s = scroller(1000);
    const { result } = mount([0]);
    act(() => result.current.scrollRef(s.el));
    act(() => { s.setTop(s.bottom()); s.scroll(); });

    // The composer: ArrowUp moves the caret, Space types, PageDown is a no-op — none of them
    // scrolls the transcript, and arming the gesture here would pause it on the next reflow.
    const composer = document.createElement('textarea');
    const field = document.createElement('input');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const typed = document.createElement('span');
    editable.appendChild(typed);
    document.body.append(composer, field, editable);

    act(() => { press('ArrowUp', composer); press(' ', field); press('PageDown', typed); s.setTop(140); s.scroll(); });
    expect(result.current.atBottom).toBe(true);
    expect(result.current.following.current).toBe(true);
  });
});

describe('paging toward the live tail (VS-714)', () => {
  function mountWithNewer(newer: { hasNewer: boolean; isLoadingNewer: boolean; loadNewer: () => void }) {
    return renderHook(
      ({ signal }: { signal: readonly unknown[] }) => useStickToBottom(signal, { exact: true, newer }),
      { initialProps: { signal: [0] } },
    );
  }

  it('asks for a newer page once the scroll gets near the bottom of what is loaded', () => {
    const loadNewer = vi.fn();
    const s = scroller(1000);
    const { result } = mountWithNewer({ hasNewer: true, isLoadingNewer: false, loadNewer });
    act(() => result.current.scrollRef(s.el));

    // Far from the bottom: no request yet.
    act(() => { s.setTop(0); s.scroll(); });
    expect(loadNewer).not.toHaveBeenCalled();

    // Within NEAR_BOTTOM_PX of the loaded bottom.
    act(() => { s.setTop(s.bottom() - 50); s.scroll(); });
    expect(loadNewer).toHaveBeenCalledTimes(1);
  });

  it('does not ask again while a newer page is already loading', () => {
    const loadNewer = vi.fn();
    const s = scroller(1000);
    const { result } = mountWithNewer({ hasNewer: true, isLoadingNewer: true, loadNewer });
    act(() => result.current.scrollRef(s.el));
    act(() => { s.setTop(s.bottom() - 10); s.scroll(); });
    expect(loadNewer).not.toHaveBeenCalled();
  });

  it('does not ask once there is nothing newer left to load', () => {
    const loadNewer = vi.fn();
    const s = scroller(1000);
    const { result } = mountWithNewer({ hasNewer: false, isLoadingNewer: false, loadNewer });
    act(() => result.current.scrollRef(s.el));
    act(() => { s.setTop(s.bottom() - 10); s.scroll(); });
    expect(loadNewer).not.toHaveBeenCalled();
  });
});
