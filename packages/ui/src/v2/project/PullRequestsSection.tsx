/**
 * The V2 project overview's Pull requests section (web-v2/project-overview): the open and recent pull
 * requests, an opened one's description, checks and changed files, and the shared diff renderer
 * (`components/DiffHunks` over `lib/diffLayout` / `lib/highlight`), restyled to V2.
 *
 * Read-only: nothing here approves, merges, reviews or comments.
 */
import { useCallback, useEffect, useState } from 'react';
import type { DiffHunk } from '@weave-ai/render';
import { highlightLine, languageForPath, useHighlighter } from '../../lib/highlight';
import { usePullRequest, usePullRequestDiffContext, usePullRequestDiffFile, usePullRequestDiffFiles, usePullRequests } from '../../api/hooks';
import { A, useSearchParams } from '../../app/link';
import { StatusGlyph } from '../../components/StatusGlyph';
import { SkeletonRows } from '../../components/Skeleton';
import { Markdown } from '../../components/Markdown';
import { Code, SplitHunk, UnifiedHunk, type Highlighter } from '../../components/DiffHunks';
import { useDiffLayout, type DiffLayout } from '../../lib/diffLayout';
import { ago } from '../../lib/format';
import { cx } from '../../lib/cx';
import { UNAVAILABLE } from '../../lib/pullRequestUnavailable';
import type * as T from '../../api/types';
import type { V2ProjectSectionProps } from './sections';

const CHECK_STATUS = { success: 'done', failure: 'failed', pending: 'working', none: 'idle' } as const;
const STATUS_TONE: Record<T.DiffFileSummary['status'], string> = {
  added: 'text-done',
  modified: 'text-working',
  deleted: 'text-failed',
  renamed: 'text-text-2',
};

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

const numberOf = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function PullRequestsSection({ project, ws }: V2ProjectSectionProps): React.ReactElement {
  const url = useSearchParams();
  const [open, setOpen] = useState<number | null>(() => numberOf(url['pr']));
  useEffect(() => { setOpen(numberOf(url['pr'])); }, [url['pr']]);

  const prs = usePullRequests(project.id);
  if (prs.isLoading) return <SkeletonRows rows={3} />;
  const data = prs.data;
  if (!data) return <p className="text-meta text-text-3">{UNAVAILABLE.unreachable}</p>;
  if (!data.available) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-meta leading-relaxed text-text-3">{data.reason ? UNAVAILABLE[data.reason] : UNAVAILABLE.unreachable}</p>
        {data.reason === 'unreachable' && data.message ? <p className="ac-mono text-nano text-text-4">{data.message}</p> : null}
      </div>
    );
  }

  if (open !== null) return <PullRequestDetail project={project} ws={ws} number={open} onBack={() => setOpen(null)} />;
  if (!data.open.length && !data.recent.length) {
    return <p className="text-meta text-text-3">No open pull requests, and none merged or closed in the last {data.windowDays} days.</p>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      {data.open.length ? <Group label="Open" prs={data.open} ws={ws} projectId={project.id} onOpen={setOpen} /> : null}
      {data.recent.length ? <Group label={`Merged and closed · last ${data.windowDays} days`} prs={data.recent} ws={ws} projectId={project.id} onOpen={setOpen} /> : null}
      <p className={cx('ac-mono text-nano', data.stale ? 'text-stalled' : 'text-text-4')}>
        read from the forge {ago(data.capturedAt)}
        {data.stale ? ' · the forge could not be re-read' : ''}
      </p>
    </div>
  );
}

function Group({ label, prs, ws, projectId, onOpen }: { label: string; prs: T.ProjectPullRequest[]; ws: string; projectId: string; onOpen: (n: number) => void }): React.ReactElement {
  return (
    <div>
      <div className="ac-label mb-1.5 flex items-center gap-2">
        {label}
        <span className="ac-mono text-nano text-text-4">{prs.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {prs.map((pr) => (
          <li key={pr.number}>
            <Row pr={pr} ws={ws} projectId={projectId} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ pr, ws, projectId, onOpen }: { pr: T.ProjectPullRequest; ws: string; projectId: string; onOpen: (n: number) => void }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-r4 px-1 py-1 hover:bg-bg-2">
      <div className="flex min-w-0 items-center gap-2">
        <StatusGlyph status={CHECK_STATUS[pr.checks]} size="xs" title={`checks ${pr.checks}`} />
        <button type="button" onClick={() => onOpen(pr.number)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={`Pull request #${pr.number}: ${pr.title}`}>
          <span className="ac-mono flex-none text-nano text-text-3">#{pr.number}</span>
          <span className="min-w-0 flex-1 truncate text-meta text-text-1">{pr.title}</span>
        </button>
        <StateTag pr={pr} />
        <span className="ac-mono flex-none text-nano text-text-4">{ago(pr.updatedAt)}</span>
      </div>
      <div className="ac-mono flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-nano text-text-3">
        {pr.author ? <span>{pr.author}</span> : null}
        <span className="max-w-[16rem] truncate" title={pr.headRefName}>{pr.headRefName}</span>
        {pr.ticket ? (
          <A to="/v2/w/$ws/tickets/$ticketId" params={{ ws, ticketId: pr.ticket.identifier }} className="text-accent-link">
            {pr.ticket.identifier}
          </A>
        ) : null}
        {pr.changeName ? (
          <A to="/v2/w/$ws/knowledge" params={{ ws }} search={{ project: projectId }} className="truncate text-accent-link" title={pr.changeName}>
            {pr.changeName}
          </A>
        ) : null}
        {pr.reviewDecision ? <span className="text-text-4">{pr.reviewDecision.replace(/_/g, ' ')}</span> : null}
        {pr.queue ? <span className="v2-tag text-accent-link">{pr.queue.state === 'landing' ? 'landing' : `queued${pr.queue.position === null ? '' : ` · ${pr.queue.position}`}`}</span> : null}
      </div>
    </div>
  );
}

function StateTag({ pr }: { pr: T.ProjectPullRequest }): React.ReactElement {
  if (pr.isDraft) return <span className="v2-tag text-text-3">draft</span>;
  return <span className={cx('v2-tag', pr.state === 'merged' ? 'text-done' : pr.state === 'closed' ? 'text-failed' : 'text-accent-link')}>{pr.state}</span>;
}

/** One opened pull request: its description, what it changes, its checks, and the way back. */
function PullRequestDetail({ project, ws, number, onBack }: { project: V2ProjectSectionProps['project']; ws: string; number: number; onBack: () => void }): React.ReactElement {
  const detail = usePullRequest(project.id, number);
  if (detail.isLoading) return <SkeletonRows rows={5} />;
  const data = detail.data;
  if (!data || !data.available) {
    return (
      <div className="flex flex-col gap-2">
        <BackTo onBack={onBack} />
        <p className="text-meta text-text-3">{data?.reason ? UNAVAILABLE[data.reason] : UNAVAILABLE.unreachable}</p>
      </div>
    );
  }
  const pr = data.pullRequest;
  if (!pr) {
    return (
      <div className="flex flex-col gap-2">
        <BackTo onBack={onBack} />
        <p className="text-meta text-text-3">The forge has no pull request #{number}.</p>
      </div>
    );
  }

  const totals = pr.files.reduce((acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }), { additions: 0, deletions: 0 });

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <BackTo onBack={onBack} />
        <span className="ac-mono text-nano text-text-3">#{pr.number}</span>
        <span className="min-w-0 flex-1 truncate text-ui text-text-strong">{pr.title}</span>
        <StateTag pr={pr} />
      </div>

      <div className="ac-mono flex flex-wrap items-center gap-x-2 gap-y-1 text-nano text-text-3">
        {pr.author ? <span>{pr.author}</span> : null}
        <span className="truncate" title={`${pr.headRefName} → ${pr.baseRefName}`}>{pr.headRefName} → {pr.baseRefName}</span>
        {pr.ticket ? (
          <A to="/v2/w/$ws/tickets/$ticketId" params={{ ws, ticketId: pr.ticket.identifier }} className="text-accent-link">
            {pr.ticket.identifier}
          </A>
        ) : null}
        {pr.ticket?.hasPlan ? (
          <A to="/v2/w/$ws/tickets/$ticketId" params={{ ws, ticketId: pr.ticket.identifier }} search={{ tab: 'plan' }} className="text-accent-link">
            plan
          </A>
        ) : null}
        {pr.changeName ? (
          <A to="/v2/w/$ws/knowledge" params={{ ws }} search={{ project: project.id }} className="truncate text-accent-link" title={pr.changeName}>
            {pr.changeName}
          </A>
        ) : null}
        <a href={pr.url} target="_blank" rel="noreferrer" className="v2-link">open on the forge</a>
      </div>

      {pr.body.trim() ? <Markdown className="text-meta text-text-2" source={pr.body} /> : <p className="text-meta text-text-3">No description.</p>}

      <div>
        <div className="ac-label mb-1.5 flex items-center gap-2">
          Files
          <span className="ac-mono text-nano text-text-4">{pr.files.length}</span>
          <span className="ac-mono text-nano text-done">+{totals.additions}</span>
          <span className="ac-mono text-nano text-failed">−{totals.deletions}</span>
        </div>
        <V2PullRequestDiff projectId={project.id} number={number} />
      </div>

      <div>
        <div className="ac-label mb-1.5">Checks</div>
        {pr.checkRuns.length ? (
          <ul className="flex flex-col gap-0.5">
            {pr.checkRuns.map((c) => (
              <li key={c.name} className="flex items-center gap-2 px-1">
                <StatusGlyph status={CHECK_STATUS[c.state]} size="xs" />
                <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-2">{c.name}</span>
                {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="ac-mono flex-none text-nano text-accent-link">details</a> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-text-3">No checks reported.</p>
        )}
      </div>
    </div>
  );
}

function BackTo({ onBack }: { onBack: () => void }): React.ReactElement {
  return (
    <button type="button" onClick={onBack} className="v2-link text-micro">← pull requests</button>
  );
}

/** The shared diff renderer, restyled: V2 file rows over `DiffHunks` and the same layout control. */
function V2PullRequestDiff({ projectId, number }: { projectId: string; number: number }): React.ReactElement {
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
          <button type="button" onClick={() => setLayout('unified')} className={cx('rounded-r4 border px-2 py-1 text-micro', effectiveLayout === 'unified' ? 'border-line-3 bg-bg-2 text-text-1' : 'border-line-2 text-text-3 hover:bg-bg-2')}>
            Unified
          </button>
          <button type="button" onClick={() => setLayout('split')} className={cx('rounded-r4 border px-2 py-1 text-micro', effectiveLayout === 'split' ? 'border-line-3 bg-bg-2 text-text-1' : 'border-line-2 text-text-3 hover:bg-bg-2')}>
            Side-by-side
          </button>
        </div>
      ) : null}
      <ul className="flex flex-col divide-y divide-line-1 rounded-r6 border border-line-1">
        {data.files.map((f) => (
          <li key={f.path}>
            <FileRow file={f} isOpen={open[f.path] === true} onToggle={() => setOpen((prev) => ({ ...prev, [f.path]: !prev[f.path] }))} projectId={projectId} number={number} layout={effectiveLayout} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileRow({ file, isOpen, onToggle, projectId, number, layout }: { file: T.DiffFileSummary; isOpen: boolean; onToggle: () => void; projectId: string; number: number; layout: DiffLayout }): React.ReactElement {
  return (
    <div className="flex flex-col">
      <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-left hover:bg-bg-2">
        <span aria-hidden className={cx('text-nano text-text-4 transition-transform', isOpen && 'rotate-90')}>▸</span>
        <span className={cx('v2-tag', STATUS_TONE[file.status])}>{file.status}</span>
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

function FileBody({ projectId, number, path, manifest, layout }: { projectId: string; number: number; path: string; manifest: T.DiffFileSummary; layout: DiffLayout }): React.ReactElement {
  const skip = manifest.binary || manifest.tooLarge;
  const diffFile = usePullRequestDiffFile(projectId, number, skip ? null : path);
  const hljs = useHighlighter();
  const lang = languageForPath(path);
  const highlight = useCallback<Highlighter>((text) => highlightLine(hljs, text, lang), [hljs, lang]);

  if (manifest.binary) return <p className="px-2.5 py-2 text-meta text-text-3">This file is binary.</p>;
  if (manifest.tooLarge) return <p className="px-2.5 py-2 text-meta text-text-3">This file's change is too large to render.</p>;
  if (diffFile.isLoading) return <div className="px-2.5 py-2"><SkeletonRows rows={3} /></div>;
  const data = diffFile.data;
  if (!data || !data.available) return <p className="px-2.5 py-2 text-meta text-text-3">{data?.reason ? UNAVAILABLE[data.reason] : UNAVAILABLE.unreachable}</p>;
  if (!data.file) return <p className="px-2.5 py-2 text-meta text-text-3">No content for this file.</p>;

  const hunks = data.file.hunks;
  return (
    <div className="ac-diff-code ac-mono overflow-x-auto border-t border-line-1 text-nano">
      {hunks.map((hunk, i) => (
        <div key={`${hunk.oldStart}-${hunk.newStart}`}>
          {i > 0 ? <Gap projectId={projectId} number={number} path={path} prev={hunks[i - 1]!} next={hunk} highlight={highlight} /> : null}
          <div className="bg-bg-2 px-2.5 py-0.5 text-text-4">{hunk.header}</div>
          {layout === 'unified' ? <UnifiedHunk hunk={hunk} highlight={highlight} wrap={false} /> : <SplitHunk hunk={hunk} highlight={highlight} />}
        </div>
      ))}
    </div>
  );
}

/** The unchanged region between two hunks — collapsed until the reader asks for it. */
function Gap({ projectId, number, path, prev, next, highlight }: { projectId: string; number: number; path: string; prev: DiffHunk; next: DiffHunk; highlight: Highlighter }): React.ReactElement | null {
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
