import { useCallback, useState } from 'react';

/**
 * Where the weave chat's open decisions render — a device choice, not workspace state (VS-289).
 *
 * The open cards are pinned between the transcript and the composer by default (`bottom`). A reader
 * on a wide screen may prefer the conversation to keep the full width and the cards to sit in a
 * column to its right (`split`). That is a matter of how they are reading at that moment, not a
 * property of the workspace, so it lives in `localStorage` beside the diff layout and the theme.
 * The default is the absence of the key.
 *
 * The switch and the reader are both `Chat.tsx`, one component, so unlike `chatPrefs.ts` this needs
 * no `window` event to keep two screens in step.
 */
export type DecisionLayout = 'bottom' | 'split';

const KEY = 'conductor.decisions.layout';

export function readDecisionLayout(): DecisionLayout {
  try {
    return localStorage.getItem(KEY) === 'split' ? 'split' : 'bottom';
  } catch {
    return 'bottom';
  }
}

export function useDecisionLayout(): [DecisionLayout, (l: DecisionLayout) => void] {
  const [layout, set] = useState<DecisionLayout>(readDecisionLayout);
  const setLayout = useCallback((l: DecisionLayout) => {
    set(l);
    try {
      if (l === 'bottom') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, l);
    } catch {
      /* private mode: the choice still works for this session */
    }
  }, []);
  return [layout, setLayout];
}
