/**
 * Both ends of a scrolling message list (conductor chat), in the one place that measures it.
 *
 * The bottom: a transcript that always scrolls to the newest line yanks the human away the moment
 * they scroll up to read history. This follows new content only while they are already at the
 * bottom; scrolling up pauses the follow, and reaching the bottom again — by hand or through the
 * button — resumes it. The list is opened at its bottom outright, with no animation to sit through.
 *
 * The top: when the caller pages its history, reaching the top asks for the page before the loaded
 * one, and the viewport is held on what the human was reading while that page is inserted above.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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
 */
export function useStickToBottom(
  signal: readonly unknown[],
  { ready = true, older, follow = true, contained = false }: { ready?: boolean; older?: OlderPages; follow?: boolean; contained?: boolean } = {},
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
  // The scroll listener is installed once per element, so it reads the paging state through a ref
  // rather than closing over the values this render happened to have.
  const olderRef = useRef(older);
  olderRef.current = older;

  const scrollToBottom = useCallback((instant = false) => {
    if (contained) {
      if (el) el.scrollTop = el.scrollHeight;
      return;
    }
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bottomRef.current?.scrollIntoView({ behavior: instant || reduced ? 'auto' : 'smooth', block: 'end' });
  }, [contained, el]);

  useEffect(() => {
    if (!el) return;
    // Only an upward scroll pauses the follow. A smooth scroll of our own fires scroll events all the
    // way down, and each one is still short of the bottom until the animation lands; treating those
    // as "the human scrolled away" would stop the follow it was in the middle of restoring.
    let last = el.scrollTop;
    const onScroll = (): void => {
      const top = el.scrollTop;
      const up = top < last;
      last = top;
      if (isAtBottom(el)) {
        following.current = true;
        setAtBottom(true);
        setUnread(false);
      } else if (up) {
        following.current = false;
        setAtBottom(false);
      }
      // The top of the loaded history. The distance from the bottom is captured before the request,
      // because by the time the page answers the heights have already changed.
      const pages = olderRef.current;
      if (pages?.hasOlder && !pages.isLoadingOlder && top <= NEAR_TOP_PX) {
        anchor.current = el.scrollHeight - top;
        pages.loadOlder();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
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
      setUnread(true);
      return;
    }
    // Opening is a jump; everything after it is the list following content the human watched arrive.
    const opening = !opened.current;
    opened.current = true;
    scrollToBottom(opening);
  });

  const toBottom = useCallback(() => {
    following.current = true;
    setAtBottom(true);
    setUnread(false);
    scrollToBottom();
  }, [scrollToBottom]);

  return { scrollRef: setEl, bottomRef, atBottom, unread, toBottom, following };
}
