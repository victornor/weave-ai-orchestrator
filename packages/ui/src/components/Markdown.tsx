import { useCallback, useMemo, useRef } from 'react';
import { markdownToHtml } from '../lib/markdown';
import { cx } from '../lib/cx';

function clipboardAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
}

/** `breaks` is for composer text — see `markdownToHtml`. */
export function Markdown({ source, className, breaks }: { source: string; className?: string; breaks?: boolean }): React.ReactElement {
  const html = useMemo(() => markdownToHtml(source ?? '', { breaks }), [source, breaks]);
  // React diffs `dangerouslySetInnerHTML` by the wrapper object's identity, not by `.__html`'s
  // value, so a fresh `{ __html: html }` literal on every render resets `innerHTML` — tearing down
  // and rebuilding every child node, including whatever a reader had selected — even when `html`
  // itself is unchanged. Memoising the wrapper keeps its reference stable across such a render (VS-321).
  const dangerousHtml = useMemo(() => ({ __html: html }), [html]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // One delegated handler for every `[data-copy]` element `markdownToHtml` emits — a fenced
  // block's button, or an inline code span itself — rather than wiring each one individually,
  // since they arrive as a string via `dangerouslySetInnerHTML` and not as React elements.
  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
    if (!el) return;
    // A tap that is really the end of selecting a paragraph containing inline code must not also
    // copy the code span it landed on.
    if (window.getSelection?.()?.toString()) return;

    const settle = (state: 'copied' | 'unavailable' | 'failed'): void => {
      el.setAttribute('data-copy-state', state);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => el.removeAttribute('data-copy-state'), 1600);
    };

    if (!clipboardAvailable()) {
      settle('unavailable');
      return;
    }
    navigator.clipboard.writeText(el.getAttribute('data-copy') ?? '').then(
      () => settle('copied'),
      () => settle('failed'),
    );
  }, []);

  return <div className={cx('ac-prose', className)} onClick={onClick} dangerouslySetInnerHTML={dangerousHtml} />;
}
