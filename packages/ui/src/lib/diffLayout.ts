import { useCallback, useState } from 'react';

/** Which side-by-side or unified a pull request's diff renders in — a device choice, not workspace state (VS-107). */
export type DiffLayout = 'unified' | 'split';

const KEY = 'conductor.diffLayout';

export function readDiffLayout(): DiffLayout {
  try {
    return localStorage.getItem(KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
}

export function useDiffLayout(): [DiffLayout, (l: DiffLayout) => void] {
  const [layout, set] = useState<DiffLayout>(readDiffLayout);
  const setLayout = useCallback((l: DiffLayout) => {
    set(l);
    try {
      if (l === 'unified') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, l);
    } catch {
      /* private mode: the choice still works for this session */
    }
  }, []);
  return [layout, setLayout];
}
