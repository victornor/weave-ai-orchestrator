/**
 * Follow-the-bottom for a scrolling message list (conductor chat).
 *
 * A transcript that always scrolls to the newest line yanks the human away the moment they scroll up
 * to read history. This follows new content only while they are already at the bottom; scrolling up
 * pauses the follow, and reaching the bottom again — by hand or through the button — resumes it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Within this many pixels of the bottom still counts as being at the bottom. */
const THRESHOLD_PX = 48;

export interface StickToBottom {
  /** Ref for the scrolling element. */
  scrollRef: (el: HTMLDivElement | null) => void;
  /** Ref for an empty sentinel rendered last inside the scrolled content. */
  bottomRef: React.RefObject<HTMLDivElement | null>;
  /** False once the human has scrolled up: the follow is paused and the button belongs on screen. */
  atBottom: boolean;
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
 */
export function useStickToBottom(signal: readonly unknown[]): StickToBottom {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(false);
  // Read by the content effect, which has no dependency array; state would be a render behind there.
  const following = useRef(true);
  const seen = useRef<readonly unknown[] | null>(null);

  const scrollToBottom = useCallback(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bottomRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' });
  }, []);

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
      if (el.scrollHeight - top - el.clientHeight <= THRESHOLD_PX) {
        following.current = true;
        setAtBottom(true);
        setUnread(false);
      } else if (up) {
        following.current = false;
        setAtBottom(false);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [el]);

  // No dependency array: `signal` is compared by value instead, and the first run counts as a change
  // so a chat that opens on a loaded thread starts at its newest message.
  useEffect(() => {
    if (seen.current && same(seen.current, signal)) return;
    seen.current = signal;
    if (following.current) scrollToBottom();
    else setUnread(true);
  });

  const toBottom = useCallback(() => {
    following.current = true;
    setAtBottom(true);
    setUnread(false);
    scrollToBottom();
  }, [scrollToBottom]);

  return { scrollRef: setEl, bottomRef, atBottom, unread, toBottom };
}
