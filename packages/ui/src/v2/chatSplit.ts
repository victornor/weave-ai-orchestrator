/**
 * The V2 chat split's geometry, as pure functions plus one measuring hook (VS-349).
 *
 * The mockup measures the chat shell itself and splits when it is at least 620px wide; the decisions
 * pane has its own draggable width, clamped 300–560. Keeping both as pure functions lets the
 * threshold and the clamp be tested without a layout engine — jsdom cannot measure a box.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Below this width of the chat region the decisions pane drops out and chat is full width. */
export const SPLIT_MIN_WIDTH = 620;
/** The width the decisions pane collapses to when nothing is waiting (VS-549); not a divider bound. */
export const DECISIONS_RAIL_WIDTH = 36;
/** The decisions pane's draggable bounds, and the width it opens at. */
export const DIVIDER_MIN = 300;
export const DIVIDER_MAX = 560;
export const DEFAULT_DIVIDER = 360;

export function shouldSplit(width: number): boolean {
  return width >= SPLIT_MIN_WIDTH;
}

export function clampDivider(width: number): number {
  return Math.max(DIVIDER_MIN, Math.min(DIVIDER_MAX, Math.round(width)));
}

const DIVIDER_KEY = 'conductor.v2.chat.divider';

/** The pane width chosen this session, or the default. Never crosses a tab close (sessionStorage). */
export function readDivider(): number {
  try {
    const raw = sessionStorage.getItem(DIVIDER_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? clampDivider(n) : DEFAULT_DIVIDER;
  } catch {
    return DEFAULT_DIVIDER;
  }
}

export function writeDivider(width: number): void {
  try {
    sessionStorage.setItem(DIVIDER_KEY, String(clampDivider(width)));
  } catch {
    /* private mode */
  }
}

/**
 * The observed width of an element, re-read on resize. Returns 0 before the first measurement and
 * wherever `ResizeObserver` does not exist (jsdom), which `shouldSplit` reads as "not split".
 */
export function useElementWidth<T extends HTMLElement>(): { ref: (el: T | null) => void; width: number } {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const node = useRef<T | null>(null);

  const measure = useCallback(() => {
    const el = node.current;
    if (el) setWidth(Math.round(el.getBoundingClientRect().width));
  }, []);

  const ref = useCallback(
    (el: T | null) => {
      node.current = el;
      observer.current?.disconnect();
      observer.current = null;
      if (el && typeof ResizeObserver !== 'undefined') {
        observer.current = new ResizeObserver(measure);
        observer.current.observe(el);
      }
      measure();
    },
    [measure],
  );

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, width };
}
