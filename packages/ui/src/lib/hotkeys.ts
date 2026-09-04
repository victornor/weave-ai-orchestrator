import { useEffect, useRef, useState } from 'react';

function inField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export interface Hotkey {
  /** `e.key` (case-insensitive) or `e.code`. */
  key: string;
  meta?: boolean;
  shift?: boolean;
  /** Fire even while a text field has focus (⌘K, Escape). */
  inFields?: boolean;
  run: (e: KeyboardEvent) => void;
}

export function useHotkeys(keys: Hotkey[], enabled = true): void {
  const ref = useRef(keys);
  ref.current = keys;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      for (const k of ref.current) {
        if (!k.inFields && inField(e.target)) continue;
        const meta = Boolean(k.meta);
        if (meta !== (e.metaKey || e.ctrlKey)) continue;
        if (k.shift !== undefined && k.shift !== e.shiftKey) continue;
        if (e.key.toLowerCase() !== k.key.toLowerCase() && e.code !== k.key) continue;
        e.preventDefault();
        k.run(e);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export interface ListNav {
  index: number;
  setIndex: (i: number) => void;
}

/** j/k to move, ⏎ to open, plus whatever else the list offers (c, a, s). */
export function useListNav(
  length: number,
  handlers: { onOpen?: (i: number) => void; onCreate?: () => void; onAssign?: (i: number) => void; onStatus?: (i: number) => void },
  enabled = true,
): ListNav {
  const [index, setIndex] = useState(0);
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    if (index >= length) setIndex(Math.max(0, length - 1));
  }, [length, index]);

  useHotkeys(
    [
      { key: 'j', run: () => setIndex((i) => Math.min(length - 1, i + 1)) },
      { key: 'ArrowDown', run: () => setIndex((i) => Math.min(length - 1, i + 1)) },
      { key: 'k', run: () => setIndex((i) => Math.max(0, i - 1)) },
      { key: 'ArrowUp', run: () => setIndex((i) => Math.max(0, i - 1)) },
      { key: 'Enter', run: () => h.current.onOpen?.(index) },
      { key: 'c', run: () => h.current.onCreate?.() },
      { key: 'a', run: () => h.current.onAssign?.(index) },
      { key: 's', run: () => h.current.onStatus?.(index) },
    ],
    enabled && length > 0,
  );

  return { index, setIndex };
}
