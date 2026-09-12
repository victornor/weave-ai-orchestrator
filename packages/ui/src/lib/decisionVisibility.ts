/**
 * Which open decisions the pinned region keeps while the chat's inline cards are on screen (VS-309).
 *
 * The inline card is the answerable one while it is readable; the pinned region is the safety net
 * for the ones that are not. A card counts as on screen only when enough of it is visible to read
 * and press: a one-pixel sliver must not suppress the pinned copy and leave the human with neither.
 *
 * `readablyVisible` and `pinnedOpenDecisions` are pure, so the threshold is behavior the tests own
 * rather than something only the browser decides; `useOnScreenDecisions` supplies the on-screen set
 * from an `IntersectionObserver` rooted at the chat's scroll container.
 */
import type { Decision } from '@weave-ai/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isHiddenFromChat, type HiddenMap } from './hiddenDecisions';

/** At or above this fraction of the card, it is readable. */
export const READABLE_MIN_RATIO = 0.5;
/** …or this much of it is showing, for a card taller than the viewport that can never reach the ratio. */
export const READABLE_MIN_PX = 180;

export interface CardVisibility {
  ratio: number;
  heightPx: number;
  visiblePx: number;
}

/** Whether enough of a card is on screen to read its title and press its first action. */
export function readablyVisible({ ratio, heightPx, visiblePx }: CardVisibility): boolean {
  // A card with no measured height (detached, or an unstyled test element) falls back to the ratio.
  if (heightPx <= 0) return ratio >= READABLE_MIN_RATIO;
  return ratio >= READABLE_MIN_RATIO || visiblePx >= READABLE_MIN_PX;
}

/** The open decisions the pinned region still shows: not hidden on this device, and not on screen. */
export function pinnedOpenDecisions(
  open: readonly Decision[],
  hidden: HiddenMap,
  onScreenIds: ReadonlySet<string>,
  now: number = Date.now(),
): Decision[] {
  return open.filter((d) => !isHiddenFromChat(d, hidden, now) && !onScreenIds.has(d.id));
}

export interface OnScreenDecisions {
  onScreen: ReadonlySet<string>;
  /** Register (or, with `null`, unregister) the host element of an open inline card. */
  register: (id: string, el: HTMLElement | null) => void;
}

/**
 * The ids of open decisions whose inline card is readably on screen, observed against `root`. With
 * no root yet, or no `IntersectionObserver`, the set stays empty and the pin shows every decision —
 * the safe direction, since a waiting card is never hidden and a duplicate is at worst transient.
 */
export function useOnScreenDecisions(root: HTMLElement | null): OnScreenDecisions {
  const [onScreen, setOnScreen] = useState<ReadonlySet<string>>(() => new Set());
  const observed = useRef(new Map<string, HTMLElement>());
  const ids = useRef(new WeakMap<Element, string>());
  const ioRef = useRef<IntersectionObserver | null>(null);

  const register = useCallback((id: string, el: HTMLElement | null) => {
    const previous = observed.current.get(id);
    if (previous && previous !== el) {
      ioRef.current?.unobserve(previous);
      ids.current.delete(previous);
      observed.current.delete(id);
    }
    if (el) {
      observed.current.set(id, el);
      ids.current.set(el, id);
      ioRef.current?.observe(el);
      return;
    }
    // Detached: drop it from the on-screen set so the pin takes it back.
    setOnScreen((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : prev));
  }, []);

  useEffect(() => {
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        setOnScreen((prev) => {
          let next: Set<string> | null = null;
          for (const entry of entries) {
            const id = ids.current.get(entry.target);
            if (!id) continue;
            const heightPx = entry.boundingClientRect.height;
            const visiblePx = entry.intersectionRect.height;
            const ratio = heightPx > 0 ? visiblePx / heightPx : entry.intersectionRatio;
            const visible = readablyVisible({ ratio, heightPx, visiblePx });
            if (visible === prev.has(id)) continue;
            if (!next) next = new Set(prev);
            if (visible) next.add(id);
            else next.delete(id);
          }
          return next ?? prev;
        });
      },
      // The threshold is what makes a sliver not count; see READABLE_MIN_RATIO.
      { root, threshold: [0, READABLE_MIN_RATIO] },
    );
    ioRef.current = io;
    for (const el of observed.current.values()) io.observe(el);
    return () => {
      io.disconnect();
      ioRef.current = null;
      setOnScreen((prev) => (prev.size ? new Set() : prev));
    };
  }, [root]);

  return { onScreen, register };
}
