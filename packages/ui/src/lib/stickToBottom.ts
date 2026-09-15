/**
 * Both ends of a scrolling message list (weave chat), in the one place that measures it.
 *
 * The bottom: a transcript that always scrolls to the newest line yanks the human away the moment
 * they scroll up to read history. This follows new content only while they are already at the
 * bottom; a human scrolling up (a wheel, a touch, a scroll key, a scrollbar drag) pauses the follow,
 * and reaching the bottom again — by hand or through the button — resumes it. A scroll the browser
 * makes on its own never pauses: content shrinking under a clamped list, an older page anchoring, or
 * the composer growing so the list gets shorter are all geometry, not the human (VS-451). The list
 * is opened at its bottom outright, with no animation to sit through.
 *
 * The top: when the caller pages its history, reaching the top asks for the page before the loaded
 * one, and the viewport is held on what the human was reading while that page is inserted above.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { record } from './scrollDiagnostics';

/** Within this many pixels of the bottom still counts as being at the bottom. */
const THRESHOLD_PX = 48;

/**
 * Is this element showing its newest content? The one definition of "at the bottom", so a caller
 * that needs the answer outside the hook — recording a reading position on the way out — cannot
 * drift from what the follow itself measures.
 */
export function isAtBottom(el: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= THRESHOLD_PX;
}
/** Within this many pixels of the top counts as asking for the page before the loaded history. */
const NEAR_TOP_PX = 120;

/**
 * How long after a scroll gesture a scroll event still counts as the human's. The events an input
 * causes arrive in the frames after it — a wheel's easing, a touch's momentum — so the gesture is
 * remembered rather than only honoured while it is held. Short enough that a later reflow is not
 * mistaken for it.
 */
const HUMAN_SCROLL_MS = 200;

/** The keys a browser scrolls a focused list on; a typed character must not count as a gesture. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);

/** The older end of the list, for a caller that pages its history. */
export interface OlderPages {
  /** False once the loaded history reaches the beginning: nothing more is asked for. */
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => void;
}

export interface StickToBottom {
  /** Ref for the scrolling element. */
  scrollRef: (el: HTMLDivElement | null) => void;
  /** Ref for an empty sentinel rendered last inside the scrolled content. */
  bottomRef: React.RefObject<HTMLDivElement | null>;
  /** False once the human has scrolled up: the follow is paused and the button belongs on screen. */
  atBottom: boolean;
  /**
   * The same answer, live rather than a render behind. A caller with its own scroll listener is
   * reading it inside the event this hook has just classified — a rendered value would still be
   * describing the event before it — and the follow's own scrolling is exactly what such a caller
   * has to tell apart from the human's.
   */
  following: React.RefObject<boolean>;
  /** Content arrived while they were scrolled up. */
  unread: boolean;
  /** Scroll to the bottom and resume following. */
  toBottom: () => void;
}

const same = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/**
 * `signal` is whatever changes when content arrives — query data, event counts. It is compared by
 * value on every render rather than used as an effect dependency, so a caller can mix the two
 * without flattening them into one stable list.
 *
 * `ready` says the content this list opens on has loaded. A list is not positioned at all before
 * then: the opening jump belongs to the first real content, and a caller whose query is disabled
 * until it knows what to ask for must say so, or the jump is spent on the empty list it shows first.
 *
 * `follow` is what a list that is still growing wants and a finished one does not: a transcript
 * read back after its turn ended must open on its first line, not be dragged to its last. Turning
 * it off suppresses the scrolling only — the upward-scroll pause and the button still work, so a
 * list whose content stops arriving simply stops moving on its own.
 *
 * `contained` is for a list nested inside another scrolling one — a turn's transcript in the
 * ticket's feed. `scrollIntoView` walks every scrollable ancestor, so a box following its own
 * bottom would drag the page it sits in down with it on every event; a contained list moves its own
 * scroll offset and nothing else. There is no animation to sit through at that size.
 *
 * `exact` makes "the bottom" the scroll element's own `scrollHeight - clientHeight` rather than the
 * sentinel's position, and follows with an animation this hook drives itself. Both matter to the V2
 * chat. The sentinel is the last child *inside* the scroller, so `padding-bottom` on the scroller
 * sits below it and `scrollIntoView({ block: 'end' })` stops that padding short of the true bottom —
 * measured 19px on a 1000px list with the 20px the chat uses, inside the 48px at-bottom threshold, so
 * nothing ever corrects it. And a native smooth scroll cannot be re-targeted while content grows:
 * each call restarts it and a stream of them (a live turn, a streaming reveal) stalls it short.
 * In this mode a `requestAnimationFrame` loop eases `scrollTop` toward a bottom read afresh every
 * frame, so it follows content that keeps growing and still settles exactly on the final bottom.
 */
export function useStickToBottom(
  signal: readonly unknown[],
  {
    ready = true,
    older,
    follow = true,
    contained = false,
    exact = false,
  }: { ready?: boolean; older?: OlderPages; follow?: boolean; contained?: boolean; exact?: boolean } = {},
): StickToBottom {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(false);
  // Read by the content effect, which has no dependency array; state would be a render behind there.
  const following = useRef(true);
  const seen = useRef<readonly unknown[] | null>(null);
  /** Whether the list has been positioned against real content once. That first time is a jump. */
  const opened = useRef(false);
  /** Distance from the bottom, captured when an older page was asked for; null the rest of the time. */
  const anchor = useRef<number | null>(null);
  /** The in-flight exact-mode follow, so a second request does not stack loops and a scroll-up stops it. */
  const anim = useRef<number | null>(null);
  // The scroll listener is installed once per element, so it reads the paging state through a ref
  // rather than closing over the values this render happened to have.
  const olderRef = useRef(older);
  olderRef.current = older;

  const reducedMotion = useCallback(
    (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const stopAnim = useCallback(() => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  }, []);

  const scrollToBottom = useCallback((instant = false) => {
    if (contained) {
      if (el) el.scrollTop = el.scrollHeight;
      return;
    }
    if (!exact) {
      bottomRef.current?.scrollIntoView({ behavior: instant || reducedMotion() ? 'auto' : 'smooth', block: 'end' });
      return;
    }
    if (!el) return;
    const target = (): number => el.scrollHeight - el.clientHeight;
    if (instant || reducedMotion()) {
      stopAnim();
      el.scrollTop = target();
      return;
    }
    // One loop, its target recomputed every frame: content still growing (a reveal, a stream) is
    // followed without restarting, and the last frame lands exactly on the true bottom.
    if (anim.current !== null) return;
    const step = (): void => {
      if (!following.current || !opened.current) { anim.current = null; return; }
      const to = target();
      const diff = to - el.scrollTop;
      // Settle within a whole pixel. The window is a pixel, not a half, because `scrollTop` is
      // quantized in some engines: a sub-pixel step makes no progress and must not be mistaken for
      // the list being clamped. The final write is `scrollHeight`, which a real engine clamps to
      // the maximum offset — landing exactly on the true bottom whatever the integer rounding of
      // `scrollHeight - clientHeight` made the computed target.
      if (diff <= 1) { el.scrollTop = el.scrollHeight; anim.current = null; return; }
      const before = el.scrollTop;
      el.scrollTop += diff * 0.25;
      // Clamped at the scroll maximum: another frame would ask for the same thing forever.
      if (el.scrollTop === before) { anim.current = null; return; }
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [contained, exact, el, reducedMotion, stopAnim]);

  useEffect(() => stopAnim, [stopAnim]);

  useEffect(() => {
    if (!el) return;
    // Only a scroll the human made pauses the follow (VS-451). The browser also moves `scrollTop`
    // on its own — content shrinking under a list clamped at its end, an older page anchoring, the
    // composer growing so the list gets shorter and its maximum offset drops — and reading any of
    // those as "the human scrolled up" is what stopped the follow without one. So an off-bottom
    // position only pauses when a wheel, touch, scroll key or scrollbar drag is behind it; a purely
    // geometric move never does. Our own smooth follow moves *down*, so it is never mistaken for
    // the human's, and the upward-scroll button/unread behaviour is unchanged for a real scroll-up.
    let last = el.scrollTop;
    let lastHuman = 0;
    let pointerDown = false;
    let touching = false;
    const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const markHuman = (): void => { lastHuman = now(); };
    const human = (): boolean => touching || pointerDown || now() - lastHuman <= HUMAN_SCROLL_MS;
    const onWheel = (): void => markHuman();
    const onTouchStart = (): void => { touching = true; markHuman(); };
    const onTouchMove = (): void => markHuman();
    const onTouchEnd = (): void => { touching = false; markHuman(); };
    const onKeyDown = (e: KeyboardEvent): void => { if (SCROLL_KEYS.has(e.key)) markHuman(); };
    // A scrollbar drag starts on the scroller itself; a click on a message must not arm it.
    const onPointerDown = (e: PointerEvent): void => { if (e.target === el) { pointerDown = true; markHuman(); } };
    const onPointerUp = (): void => { if (!pointerDown) return; pointerDown = false; markHuman(); };
    const onScroll = (): void => {
      const top = el.scrollTop;
      const up = top < last;
      last = top;
      if (isAtBottom(el)) {
        following.current = true;
        setAtBottom(true);
        setUnread(false);
      } else if (up && human()) {
        // Their own movement away from the bottom, not ours: a downward scroll (including the
        // frames of our own follow, which can still fall inside the gesture window) never pauses.
        following.current = false;
        setAtBottom(false);
      }
      record({ event: 'scroll', scrollTop: top, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atBottom: isAtBottom(el), following: following.current, opened: opened.current });
      // The top of the loaded history. The distance from the bottom is captured before the request,
      // because by the time the page answers the heights have already changed.
      const pages = olderRef.current;
      if (pages?.hasOlder && !pages.isLoadingOlder && top <= NEAR_TOP_PX) {
        anchor.current = el.scrollHeight - top;
        pages.loadOlder();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [el]);

  // Before the paint that reveals an older page: put the viewport back the same distance from the
  // bottom, so the message the human was reading stays where they left it whatever height arrived
  // above it. Marking the signal seen is what keeps the follow below from reading a page prepended
  // at the top as new content at the bottom.
  useLayoutEffect(() => {
    if (!el || anchor.current === null) return;
    if (seen.current && same(seen.current, signal)) return;
    el.scrollTop = el.scrollHeight - anchor.current;
    anchor.current = null;
    seen.current = signal;
  });

  // No dependency array: `signal` is compared by value instead, and the first run counts as a change
  // so a chat that opens on a loaded thread starts at its newest message.
  useEffect(() => {
    if (seen.current && same(seen.current, signal)) return;
    seen.current = signal;
    // Marked seen first: a list that starts following later must not read everything it never
    // scrolled to as one burst of new content.
    if (!follow) return;
    // Nothing to be positioned against until the content this list opens on has loaded. A list that
    // scrolls before then spends its one opening jump on an empty box, and the history it was
    // waiting for arrives to an already-opened list — which animates in from the top instead.
    if (!ready) return;
    if (!following.current) {
      if (el) record({ event: 'follow', scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atBottom: isAtBottom(el), following: false, opened: opened.current });
      setUnread(true);
      return;
    }
    // Opening is a jump; everything after it is the list following content the human watched arrive.
    const opening = !opened.current;
    opened.current = true;
    if (el) record({ event: 'follow', scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atBottom: isAtBottom(el), following: true, opened: opened.current });
    scrollToBottom(opening);
  });

  // Geometry, not content. The keyboard opening takes half the list's height away, a decision card
  // pinning below it takes more, a web font or an image landing changes what the same messages are
  // worth — and none of those are a change to `signal`, so the effect above never runs and a list
  // that was showing its newest message quietly stops. Re-pinning is a correction rather than
  // something to watch arrive, so it is instant even mid-follow, and it waits for the opening jump:
  // before that the list has no position for this to be restoring.
  useEffect(() => {
    if (!el || !follow) return;
    const pin = (): void => {
      record({ event: 'pin', scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atBottom: isAtBottom(el), following: following.current, opened: opened.current });
      if (!opened.current || !following.current) return;
      // A geometry correction is instant for a fixed-size list, but in `exact` mode the same growth
      // is often content arriving (a streaming reveal), where an instant jump would jank; the rAF
      // loop is a no-op when there is nothing to correct.
      scrollToBottom(!exact);
    };
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(pin);
    ro?.observe(el);
    // The scrolled content, whose height is what actually changes when the list itself has not.
    const content = el.firstElementChild;
    if (content) ro?.observe(content);
    // The visual viewport, which the keyboard shrinks without resizing a single element.
    window.visualViewport?.addEventListener('resize', pin);
    window.addEventListener('resize', pin);
    return () => {
      ro?.disconnect();
      window.visualViewport?.removeEventListener('resize', pin);
      window.removeEventListener('resize', pin);
    };
  }, [el, follow, exact, scrollToBottom]);

  const toBottom = useCallback(() => {
    following.current = true;
    setAtBottom(true);
    setUnread(false);
    scrollToBottom();
  }, [scrollToBottom]);

  return { scrollRef: setEl, bottomRef, atBottom, unread, toBottom, following };
}
