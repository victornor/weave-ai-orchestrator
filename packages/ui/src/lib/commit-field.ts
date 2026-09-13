/**
 * A Settings text/number field's commit state (VS-141): a draft that only reaches the server on an
 * explicit action — `Enter`, a visible save control, blur, or the field unmounting while dirty — never
 * on blur alone, since blur does not fire on a phone reload, a backgrounded PWA, or a JS-triggered
 * navigation. The status is always visible, so leaving the page either saves the value or leaves an
 * "unsaved" state on screen at the moment of leaving.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type CommitStatusValue = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface CommittableField {
  draft: string;
  status: CommitStatusValue;
  error: string | undefined;
  onChange: (raw: string) => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Commits the current draft regardless of what triggered it — the explicit save action and retry both call this. */
  commitNow: () => void;
}

/** How long a successful save stays visible before the indicator clears back to nothing. */
const SAVED_HOLD_MS = 2000;

/**
 * `value` is the last-known-saved value (from server data); `onCommit` does this field's own
 * parsing/validation and issues the mutation, rejecting with an `Error` whose message is shown as the
 * field's error. `draft` only resyncs from a changed `value` while the field is clean — a save in
 * flight, or an unresolved error, is never clobbered by a query refetch landing mid-edit.
 *
 * `multiline` is opt-in (VS-322): a text area needs plain Enter to insert a line break, so in that
 * mode only Cmd/Ctrl+Enter commits on the keyboard; every other field keeps save-on-Enter.
 */
export function useCommittableField(opts: { value: string; onCommit: (raw: string) => Promise<void>; multiline?: boolean }): CommittableField {
  const { value, onCommit, multiline = false } = opts;
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<CommitStatusValue>('idle');
  const [error, setError] = useState<string>();

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const statusRef = useRef(status);
  statusRef.current = status;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (statusRef.current === 'idle') setDraft(value);
  }, [value]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const commit = useCallback((raw: string) => {
    setStatus('saving');
    setError(undefined);
    onCommitRef
      .current(raw)
      .then(() => {
        setStatus('saved');
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), SAVED_HOLD_MS);
      })
      .catch((e: unknown) => {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Could not save');
      });
  }, []);

  // Unmounting while dirty flushes the pending edit (VS-141 AC #1's "navigating away" — switching
  // Settings sections unmounts the field). React Query's request is not tied to this component's
  // lifetime, so a fire-and-forget call from an unmounting field still reaches the server; there is
  // nothing left here to show its result to.
  useEffect(
    () => () => {
      if (statusRef.current === 'dirty') void onCommitRef.current(draftRef.current).catch(() => {});
    },
    [],
  );

  const onChange = useCallback(
    (raw: string) => {
      setDraft(raw);
      setError(undefined);
      setStatus(raw === value ? 'idle' : 'dirty');
    },
    [value],
  );

  const commitNow = useCallback(() => {
    if (statusRef.current === 'dirty' || statusRef.current === 'error') commit(draftRef.current);
  }, [commit]);

  const onBlur = useCallback(() => {
    if (statusRef.current === 'dirty') commit(draftRef.current);
  }, [commit]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (multiline && !e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      commitNow();
    },
    [commitNow, multiline],
  );

  return { draft, status, error, onChange, onBlur, onKeyDown, commitNow };
}
