/**
 * The unified/split hunk renderer (VS-107), extracted out of `PullRequestDiff.tsx` (VS-324) so a
 * transcript's edit-tool diffs can share it instead of duplicating it. Pure rendering over a
 * `DiffHunk` — nothing here cares whether it came from a real unified diff (`parseUnifiedDiff`) or
 * a synthesised one (`diffHunksForEdits`).
 */
import { useMemo } from 'react';
import type { DiffHunk, DiffLine } from '@weave-ai/render';
import { cx } from '../lib/cx';

/** One line's text, turned into a highlighted-or-plain HTML string (VS-107 / ADR 0013). */
export type Highlighter = (text: string) => string;

/** Diff lines use the diff tokens (VS-419), never the status ones: Mono greys out `--status-done`,
 *  so `bg-done` made added lines read as context. */
const LINE_BG: Record<DiffLine['kind'], string> = { add: 'bg-diff-add-bg', remove: 'bg-diff-remove-bg', context: '' };

/**
 * Highlighted markup is trusted here: `highlightLine` escapes the source text itself
 * (`lib/highlight.ts`). The wrapped `{ __html }` is memoised on the text (and the stable
 * `highlight`, which closes over the language), because React 19 compares `dangerouslySetInnerHTML`
 * by reference: a fresh object on every render rewrites the line's DOM even when the text is
 * identical, clearing any selection inside it.
 */
export function Code({ text, highlight }: { text: string; highlight: Highlighter }): React.ReactElement {
  const html = useMemo(() => ({ __html: highlight(text) }), [text, highlight]);
  return <span dangerouslySetInnerHTML={html} />;
}

/**
 * Unified by default, with `wrap` making each row wrap inside the hunk rather than overflow it
 * (VS-344). A transcript cell wraps so a long line cannot spill out of the cell; the pull-request
 * diff view passes `wrap={false}` and keeps its own horizontal scroll, because a unified line has
 * the whole container's width and scrolling it is a legitimate reading choice there.
 */
export function UnifiedHunk({ hunk, highlight, wrap = true }: { hunk: DiffHunk; highlight: Highlighter; wrap?: boolean }): React.ReactElement {
  return (
    <div>
      {hunk.lines.map((line, i) => (
        <div key={i} className={cx('flex', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre', LINE_BG[line.kind])}>
          <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{line.oldLine ?? ''}</span>
          <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{line.newLine ?? ''}</span>
          <span className={cx('px-1.5', wrap && 'min-w-0 flex-1')}>
            {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
            <Code text={line.text} highlight={highlight} />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Side by side, each column wrapping its own long lines (VS-344). `min-w-0` lets a column shrink
 * below its content and `overflow-hidden` is the belt to the wrapping braces; the code span takes
 * the free width so a wrapped continuation hangs under the code, not under the line-number gutter.
 * Not a paired diff the way GitHub's split view aligns a removed line with its replacement — each
 * side is simply every line it has, in order. Good enough to read side by side; exact pairing is a
 * refinement, not a correctness requirement of this view.
 */
export function SplitHunk({ hunk, highlight }: { hunk: DiffHunk; highlight: Highlighter }): React.ReactElement {
  const left = hunk.lines.filter((l) => l.kind !== 'add');
  const right = hunk.lines.filter((l) => l.kind !== 'remove');
  const rows = Math.max(left.length, right.length);
  return (
    <div className="grid grid-cols-2 divide-x divide-line-1">
      <div className="min-w-0 overflow-hidden">
        {Array.from({ length: rows }, (_, i) => left[i]).map((line, i) => (
          <div key={i} className={cx('flex', line ? LINE_BG[line.kind] : '')}>
            <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{line?.oldLine ?? ''}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words px-1.5">{line ? <><span>{line.kind === 'remove' ? '-' : ' '}</span><Code text={line.text} highlight={highlight} /></> : null}</span>
          </div>
        ))}
      </div>
      <div className="min-w-0 overflow-hidden">
        {Array.from({ length: rows }, (_, i) => right[i]).map((line, i) => (
          <div key={i} className={cx('flex', line ? LINE_BG[line.kind] : '')}>
            <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{line?.newLine ?? ''}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words px-1.5">{line ? <><span>{line.kind === 'add' ? '+' : ' '}</span><Code text={line.text} highlight={highlight} /></> : null}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
