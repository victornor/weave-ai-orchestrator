/**
 * A pull request's diff, file by file (VS-107): the file tree the "Files" list of
 * `PullRequestsSection.tsx` opens into. Each file loads its hunks only once it is opened — the
 * client-side half of per-file loading, the manifest's own read already being the cheap half — and
 * a collapsed region between two hunks expands from the base revision's own content, read on demand.
 *
 * Read-only throughout: nothing here edits, comments, approves or merges. That stays the decision
 * card's, and the pull request's description/checks panel above this, exactly as VS-97 left them.
 */
import { useEffect, useState } from 'react';
import type { DiffHunk } from '@weave-ai/render';
import { languageForPath, useHighlighter } from '../../lib/highlight';
import { usePullRequestDiffContext, usePullRequestDiffFile, usePullRequestDiffFiles } from '../../api/hooks';
import { Badge } from '../../components/StatusGlyph';
import { Button } from '../../components/Button';
import { SkeletonRows } from '../../components/Skeleton';
import { Code, SplitHunk, UnifiedHunk, type Highlighter } from '../../components/DiffHunks';
import { useDiffLayout, type DiffLayout } from '../../lib/diffLayout';
import { cx } from '../../lib/cx';
import { UNAVAILABLE } from '../../lib/pullRequestUnavailable';
import type * as T from '../../api/types';

/** A media query as a boolean that follows changes (mirrors HistorySection.tsx's local hook). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const STATUS_TONE: Record<T.DiffFileSummary['status'], 'added' | 'modified' | 'removed' | 'accent'> = {
  added: 'added', modified: 'modified', deleted: 'removed', renamed: 'accent',
};

export function PullRequestDiff({ projectId, number }: { projectId: string; number: number }): React.ReactElement {
  const phone = useMediaQuery('(max-width: 767px)');
  const [layout, setLayout] = useDiffLayout();
  const effectiveLayout: DiffLayout = phone ? 'unified' : layout;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const files = usePullRequestDiffFiles(projectId, number);

  if (files.isLoading) return <SkeletonRows rows={3} />;
  const data = files.data;
  if (!data || !data.available) return <p className="text-meta text-text-3">{data?.reason ? UNAVAILABLE[data.reason] : UNAVAILABLE.unreachable}</p>;
  if (!data.files.length) return <p className="text-meta text-text-3">The forge reported no changed files.</p>;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {!phone ? (
        <div className="flex items-center gap-1.5 self-end">
          <Button variant={effectiveLayout === 'unified' ? 'secondary' : 'ghost'} size="sm" onClick={() => setLayout('unified')}>
            Unified
          </Button>
          <Button variant={effectiveLayout === 'split' ? 'secondary' : 'ghost'} size="sm" onClick={() => setLayout('split')}>
            Side-by-side
          </Button>
        </div>
      ) : null}
      <ul className="flex flex-col divide-y divide-line-1 rounded-r6 border border-line-1">
        {data.files.map((f) => (
          <li key={f.path}>
            <FileRow
              file={f}
              isOpen={open[f.path] === true}
              onToggle={() => setOpen((prev) => ({ ...prev, [f.path]: !prev[f.path] }))}
              projectId={projectId}
              number={number}
              layout={effectiveLayout}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileRow({
  file, isOpen, onToggle, projectId, number, layout,
}: { file: T.DiffFileSummary; isOpen: boolean; onToggle: () => void; projectId: string; number: number; layout: DiffLayout }): React.ReactElement {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-left hover:bg-bg-2"
      >
        <span aria-hidden className={cx('text-nano text-text-4 transition-transform', isOpen && 'rotate-90')}>▸</span>
        <Badge tone={STATUS_TONE[file.status]}>{file.status}</Badge>
        <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-2" title={file.path}>
          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        </span>
        <span className="ac-mono flex-none text-nano text-done">+{file.additions}</span>
        <span className="ac-mono flex-none text-nano text-failed">−{file.deletions}</span>
      </button>
      {isOpen ? <FileBody projectId={projectId} number={number} path={file.path} manifest={file} layout={layout} /> : null}
    </div>
  );
}

function FileBody({
  projectId, number, path, manifest, layout,
}: { projectId: string; number: number; path: string; manifest: T.DiffFileSummary; layout: DiffLayout }): React.ReactElement {
  // A binary or too-large file is already known from the manifest — no point spending a request on
  // hunks that will never render.
  const skip = manifest.binary || manifest.tooLarge;
  const diffFile = usePullRequestDiffFile(projectId, number, skip ? null : path);
  const lang = languageForPath(path);
  // Stable per (language, readiness), so a line whose text is unchanged keeps its `{ __html }` object
  // (and its DOM) instead of having React rewrite it on every render and clear a selection (VS-323).
  const highlight = useHighlighter(lang);

  if (manifest.binary) return <p className="px-2.5 py-2 text-meta text-text-3">This file is binary.</p>;
  if (manifest.tooLarge) return <p className="px-2.5 py-2 text-meta text-text-3">This file's change is too large to render.</p>;
  if (diffFile.isLoading) return <div className="px-2.5 py-2"><SkeletonRows rows={3} /></div>;
  const data = diffFile.data;
  if (!data || !data.available) return <p className="px-2.5 py-2 text-meta text-text-3">{data?.reason ? UNAVAILABLE[data.reason] : UNAVAILABLE.unreachable}</p>;
  if (!data.file) return <p className="px-2.5 py-2 text-meta text-text-3">No content for this file.</p>;

  const hunks = data.file.hunks;
  return (
    <div className="ac-code ac-mono overflow-x-auto border-t border-line-1 text-nano">
      {hunks.map((hunk, i) => (
        <div key={`${hunk.oldStart}-${hunk.newStart}`}>
          {i > 0 ? <Gap projectId={projectId} number={number} path={path} prev={hunks[i - 1]!} next={hunk} highlight={highlight} /> : null}
          <HunkHeader hunk={hunk} />
          {layout === 'unified' ? <UnifiedHunk hunk={hunk} highlight={highlight} wrap={false} /> : <SplitHunk hunk={hunk} highlight={highlight} />}
        </div>
      ))}
    </div>
  );
}

function HunkHeader({ hunk }: { hunk: DiffHunk }): React.ReactElement {
  return <div className="bg-bg-2 px-2.5 py-0.5 text-text-4">{hunk.header}</div>;
}

/** The unchanged region between two hunks — collapsed until the reader asks for it. */
function Gap({
  projectId, number, path, prev, next, highlight,
}: { projectId: string; number: number; path: string; prev: DiffHunk; next: DiffHunk; highlight: Highlighter }): React.ReactElement | null {
  const baseStart = prev.oldStart + prev.oldLines;
  const baseEnd = next.oldStart - 1;
  const [expanded, setExpanded] = useState(false);
  const range = expanded && baseStart <= baseEnd ? { start: baseStart, end: baseEnd } : null;
  const ctx = usePullRequestDiffContext(projectId, number, path, range);

  if (baseStart > baseEnd) return null;
  const delta = (prev.newStart + prev.newLines) - baseStart;

  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="flex w-full items-center gap-2 bg-bg-2 px-2.5 py-1 text-left text-text-3 hover:text-text-1">
        <span aria-hidden>⋯</span>
        Expand {baseEnd - baseStart + 1} lines
      </button>
    );
  }
  if (ctx.isLoading) return <div className="px-2.5 py-1"><SkeletonRows rows={2} /></div>;
  if (!ctx.data || !ctx.data.available) return <p className="px-2.5 py-1 text-text-3">This range is not available.</p>;
  return (
    <div>
      {ctx.data.lines.map((text, i) => (
        <div key={i} className="flex whitespace-pre">
          <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{baseStart + i}</span>
          <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{baseStart + i + delta}</span>
          <span className="px-1.5"> <Code text={text} highlight={highlight} /></span>
        </div>
      ))}
    </div>
  );
}
