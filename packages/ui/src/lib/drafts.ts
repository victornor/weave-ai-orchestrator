/**
 * Unsent composer text, held while the human is somewhere else in the app.
 *
 * A draft belongs to one conversation in one workspace, so the key carries both: nothing typed in
 * one workspace can surface in another. `sessionStorage`, not `localStorage` — a draft is for this
 * tab and this sitting, so it survives a reload and a walk around the app but does not wait on a
 * shared device for whoever opens the browser next.
 */
import { useCallback, useEffect, useState } from 'react';

export interface Draft {
  text: string;
  /** The conductor message the draft answers, where the composer offers replies. */
  replyToId?: string | null;
  /** The project chosen beside the input; absent means the human has not touched the picker. */
  projectId?: string | null;
}

export interface DraftHandle {
  draft: Draft;
  /** Merge into the draft and persist it. */
  patch: (p: Partial<Draft>) => void;
  /** Drop the whole draft, meta included: what sending, or clearing the field, leaves behind. */
  clear: () => void;
}

const PREFIX = 'conductor.draft';
const EMPTY: Draft = { text: '' };

/** `<ws>` and `<thread>` name the conversation; a draft never crosses either. */
export function draftKey(ws: string, thread: string): string {
  return `${PREFIX}.${ws}.${thread}`;
}

/** Nothing worth keeping: the entry is removed rather than stored empty. */
function isEmpty(d: Draft): boolean {
  return !d.text && !d.replyToId && d.projectId === undefined;
}

export function readDraft(key: string | null): Draft {
  if (!key) return EMPTY;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return { ...parsed, text: typeof parsed.text === 'string' ? parsed.text : '' };
  } catch {
    // Private mode, a disabled store, or a half-written entry: a lost draft is not worth an error.
    return EMPTY;
  }
}

export function writeDraft(key: string | null, draft: Draft): void {
  if (!key) return;
  try {
    if (isEmpty(draft)) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* private mode */
  }
}

/**
 * The draft for one conversation. `key` may be null while the thread is still loading; the draft is
 * re-read when it changes, so switching thread or workspace never carries the previous one over.
 */
export function useDraft(key: string | null): DraftHandle {
  const [held, setHeld] = useState<{ key: string | null; draft: Draft }>(() => ({ key, draft: readDraft(key) }));
  // A render-phase update, so the draft of the thread being left is never painted under the new one.
  if (held.key !== key) setHeld({ key, draft: readDraft(key) });
  const draft = held.key === key ? held.draft : readDraft(key);

  // Written on every change rather than on unmount: a tab closed or reloaded mid-sentence has no
  // unmount to run a cleanup in.
  useEffect(() => {
    if (held.key === key) writeDraft(key, held.draft);
  }, [key, held]);

  const patch = useCallback((p: Partial<Draft>) => setHeld((cur) => ({ key: cur.key, draft: { ...cur.draft, ...p } })), []);
  const clear = useCallback(() => setHeld((cur) => ({ key: cur.key, draft: EMPTY })), []);

  return { draft, patch, clear };
}
