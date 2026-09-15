/**
 * V2 motion helpers (VS-427).
 *
 * The CSS side of the polish pass lives in `index.css` (the `--v2-dur-*`/`--v2-ease*` tokens and the
 * `.v2-anim-*` classes). This module is the one piece of motion that CSS cannot express on its own:
 * holding a removed list item mounted for one animation so it can animate out instead of vanishing.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** A list item plus whether it is on its way out (VS-427). */
export interface PresenceEntry<T> {
  item: T;
  /** True for an item that has left `items` but is being held for its exit animation. */
  exiting: boolean;
}

/**
 * Keeps each item that leaves `items` rendered for `exitMs`, flagged `exiting`, so a component can
 * play an exit animation and then let it go. Items that arrive mid-exit are un-flagged and stay.
 *
 * The removal is detected in a layout effect, so the held item is committed before the browser
 * paints the shorter list — there is no frame where it is missing and then back.
 *
 * The default duration is the base motion token's value; `index.css` cannot be read from here, so the
 * two are kept in step by hand (`--v2-dur-base: 180ms`).
 */
export function useExitPresence<T>(items: readonly T[], keyOf: (item: T) => string, exitMs = 180): PresenceEntry<T>[] {
  const [leaving, setLeaving] = useState<readonly T[]>([]);
  const previous = useRef(items);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useLayoutEffect(() => {
    const present = new Set(items.map(keyOf));
    const removed = previous.current.filter((it) => !present.has(keyOf(it)));
    previous.current = items;
    if (removed.length === 0) return;
    setLeaving((cur) => {
      const known = new Set(cur.map(keyOf));
      const added = removed.filter((it) => !known.has(keyOf(it)));
      return added.length ? [...cur, ...added] : cur;
    });
    for (const it of removed) {
      const k = keyOf(it);
      if (timers.current.has(k)) continue;
      timers.current.set(
        k,
        setTimeout(() => {
          timers.current.delete(k);
          setLeaving((cur) => cur.filter((x) => keyOf(x) !== k));
        }, exitMs),
      );
    }
  });

  useEffect(
    () => () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    },
    [],
  );

  const present = new Set(items.map(keyOf));
  const entries: PresenceEntry<T>[] = items.map((item) => ({ item, exiting: false }));
  for (const item of leaving) {
    if (!present.has(keyOf(item))) entries.push({ item, exiting: true });
  }
  return entries;
}

/** The items of a presence list that are not on their way out — what a count should include. */
export function presentItems<T>(entries: readonly PresenceEntry<T>[]): T[] {
  return entries.filter((e) => !e.exiting).map((e) => e.item);
}
