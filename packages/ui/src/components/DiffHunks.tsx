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

const LINE_BG: Record<DiffLine['kind'], string> = { add: 'bg-done/10', remove: 'bg-failed/10', context: '' };

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

export function UnifiedHunk({ hunk, highlight }: { hunk: DiffHunk; highlight: Highlighter }): React.ReactElement {
  return (
    <div>
      {hunk.lines.map((line, i) => (
        <div key={i} className={cx('flex whitespace-pre', LINE_BG[line.kind])}>
          <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{line.oldLine ?? ''}</span>
          <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{line.newLine ?? ''}</span>
          <span className="px-1.5">
            {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
            <Code text={line.text} highlight={highlight} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function SplitHunk({ hunk, highlight }: { hunk: DiffHunk; highlight: Highlighter }): React.ReactElement {
  // Not a paired diff the way GitHub's split view aligns a removed line with its replacement — each
  // side is simply every line it has, in order. Good enough to read side by side; exact pairing is a
  // refinement, not a correctness requirement of this view.
  const left = hunk.lines.filter((l) => l.kind !== 'add');
  const right = hunk.lines.filter((l) => l.kind !== 'remove');
  const rows = Math.max(left.length, right.length);
  return (
    <div className="grid grid-cols-2 divide-x divide-line-1">
      <div>
        {Array.from({ length: rows }, (_, i) => left[i]).map((line, i) => (
          <div key={i} className={cx('flex whitespace-pre', line ? LINE_BG[line.kind] : '')}>
            <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{line?.oldLine ?? ''}</span>
            <span className="px-1.5">{line ? <><span>{line.kind === 'remove' ? '-' : ' '}</span><Code text={line.text} highlight={highlight} /></> : null}</span>
          </div>
        ))}
      </div>
      <div>
        {Array.from({ length: rows }, (_, i) => right[i]).map((line, i) => (
          <div key={i} className={cx('flex whitespace-pre', line ? LINE_BG[line.kind] : '')}>
            <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{line?.newLine ?? ''}</span>
            <span className="px-1.5">{line ? <><span>{line.kind === 'add' ? '+' : ' '}</span><Code text={line.text} highlight={highlight} /></> : null}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
