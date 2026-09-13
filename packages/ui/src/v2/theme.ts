/**
 * The V2 (Mono) light/dark theme — HANDOFF.md §2. V2 keeps its own choice, under its own key, so
 * switching V2 does not flip V1 (and the reverse). The value lives on the `.v2-root` element, not on
 * `<html>`, which is where V1's theme lives.
 */
import { useCallback, useEffect, useState } from 'react';

export type V2Theme = 'dark' | 'light';

/** Deliberately not V1's `conductor.theme`. */
const KEY = 'weave.v2.theme';

function systemTheme(): V2Theme {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function readV2Theme(): V2Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : systemTheme();
  } catch {
    return 'dark';
  }
}

export function writeV2Theme(t: V2Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode */
  }
}

export interface V2ThemeState {
  theme: V2Theme;
  setTheme: (t: V2Theme) => void;
  toggle: () => void;
}

export function useV2Theme(): V2ThemeState {
  const [theme, set] = useState<V2Theme>(readV2Theme);

  // Keep the resolved ground in step with the OS until the human picks a side.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(KEY);
      } catch {
        /* ignore */
      }
      if (stored !== 'light' && stored !== 'dark') set(systemTheme());
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((t: V2Theme) => {
    set(t);
    writeV2Theme(t);
  }, []);

  const toggle = useCallback(() => {
    set((cur) => {
      const next: V2Theme = cur === 'dark' ? 'light' : 'dark';
      writeV2Theme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}
