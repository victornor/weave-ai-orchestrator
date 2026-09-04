import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light' | 'system';

const KEY = 'conductor.theme';

function systemTheme(): 'dark' | 'light' {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme): void {
  const resolved = t === 'system' ? systemTheme() : t;
  document.documentElement.setAttribute('data-theme', resolved);
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* private mode */
  }
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, set] = useState<Theme>(readTheme);
  const setTheme = useCallback((t: Theme) => {
    set(t);
    applyTheme(t);
  }, []);
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
  return [theme, setTheme];
}
