/**
 * The change explorer (`/w/:ws/p/:project/changes/:number`, VS-452): a pull request's changes as
 * a file tree on the left and one file's diff on the right, opened from a merge approval card so a
 * human can read what they are about to merge.
 *
 * Read-only throughout: nothing here approves, merges, comments or edits — that stays on the card.
 * The whole-file view is assembled on the client from the two reads the pull-requests service already
 * serves (`lib/wholeFile`), so no server route was needed for it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import type { DiffHunk } from '@weave-ai/render';
import { usePullRequest, usePullRequestDiffContext, usePullRequestDiffFile, usePullRequestDiffFiles, useProjects } from '../../api/hooks';
import { useWs } from '../../api/context';
import { useGo, useSearchParams } from '../../app/link';
import { Code, SplitHunk, UnifiedHunk, type Highlighter } from '../../components/DiffHunks';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState } from '../../components/States';
import { languageForPath, useHighlighter } from '../../lib/highlight';
import { useDiffLayout, type DiffLayout } from '../../lib/diffLayout';
import { buildChangeTree, filterChangeFiles, visibleChangeFiles, type ChangeFile, type ChangeNode } from '../../lib/changeTree';
import { wholeFileHunk } from '../../lib/wholeFile';
import { resolveProject } from '../../lib/projectOverview';
import { UNAVAILABLE } from '../../lib/pullRequestUnavailable';
import { cx } from '../../lib/cx';
import { V2Page } from '../V2Page';
import type * as T from '../../api/types';

/** The base read's end bound: clamped by the service to the file's own length, so this means "all of it". */
const WHOLE_FILE_END = 1_000_000;

type DiffMode = 'whole' | 'changes';

const STATUS_TONE: Record<T.DiffFileSummary['status'], string> = {
  added: 'text-done',
  modified: 'text-working',
  deleted: 'text-failed',
  renamed: 'text-text-2',
};

/** jsdom answers every media query `false`; a phone case has to say so (mirrors `PullRequestsSection`). */
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

export function V2ChangeExplorerScreen(): React.ReactElement {
  const ws = useWs();
  const params = useParams({ strict: false }) as { project?: string; number?: string };
  const number = Number(params.number);
  const validNumber = params.number !== undefined && Number.isInteger(number) && number > 0;
  const projects = useProjects();
  const project = resolveProject(projects.data ?? [], params.project);
  const projectId = project?.id ?? null;
  const go = useGo();
  const url = useSearchParams();
  const requested = url['file'] ?? null;
  const phone = useMediaQuery('(max-width: 767px)');

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [mode, setMode] = useState<DiffMode>('whole');
  const [layout, setLayout] = useDiffLayout();

  const detail = usePullRequest(projectId, validNumber ? number : null);
  const diffFiles = usePullRequestDiffFiles(projectId, validNumber ? number : null);
  const pr = detail.data?.pullRequest ?? null;
  const files = useMemo(() => (diffFiles.data?.files ?? []), [diffFiles.data]);

  const filtered = useMemo(() => filterChangeFiles(files, query), [files, query]);
  const tree = useMemo(() => buildChangeTree(filtered), [filtered]);
  const order = useMemo(() => visibleChangeFiles(tree, collapsed), [tree, collapsed]);

  const selected = useMemo(() => {
    const wanted = requested ? files.find((f) => f.path === requested) : undefined;
    if (wanted) return wanted;
    return phone ? null : (order[0]?.file ?? files[0] ?? null);
  }, [requested, files, order, phone]);

  const openFile = useCallback((path: string) => {
    go('/w/$ws/p/$project/changes/$number', { params: { ws, project: params.project ?? '', number: params.number ?? '' }, search: { file: path }, replace: true });
  }, [go, ws, params.project, params.number]);

  const clearFile = useCallback(() => {
    go('/w/$ws/p/$project/changes/$number', { params: { ws, project: params.project ?? '', number: params.number ?? '' }, search: {}, replace: true });
  }, [go, ws, params.project, params.number]);

  const goBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) { window.history.back(); return; }
    go('/w/$ws/p/$project', { params: { ws, project: params.project ?? '' } });
  }, [go, ws, params.project]);

  const totals = files.reduce((acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }), { additions: 0, deletions: 0 });

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!order.length) return;
    const at = order.findIndex((n) => n.path === selected?.path);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = order[Math.min(order.length - 1, at + 1)] ?? order[0];
      if (next) openFile(next.path);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = order[Math.max(0, at - 1)] ?? order[0];
      if (prev) openFile(prev.path);
    } else if (e.key === 'Enter' && selected) {
      e.preventDefault();
      openFile(selected.path);
    }
  };

  if (projects.isLoading) {
    return (
      <V2Page title="Changes">
        <div className="p-4 md:p-5"><SkeletonRows rows={6} /></div>
      </V2Page>
    );
  }

  if (!project || !validNumber) {
    return (
      <V2Page title="Changes" subtitle={params.project}>
        <div className="p-4 md:p-5">
          <EmptyState
            title={project ? `Pull request #${params.number} is not a valid number.` : 'No such project in this workspace.'}
            detail={<span className="ac-mono">{params.project}</span>}
            action={
              <button type="button" onClick={goBack} className="rounded-r4 border border-line-2 px-3 py-1.5 text-micro text-text-2 hover:bg-bg-2">
                Go back
              </button>
            }
          />
        </div>
      </V2Page>
    );
  }

  const headerTitle = pr?.title ?? `Pull request #${number}`;
  const headerSubtitle = pr ? `${pr.headRefName} → ${pr.baseRefName}` : project.slug;

  return (
    <V2Page
      title={headerTitle}
      subtitle={headerSubtitle}
      scroll={false}
      actions={
        <button type="button" onClick={goBack} className="rounded-r4 border border-line-2 px-2 py-1 text-micro text-text-2 hover:bg-bg-2">
          ← Back
        </button>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-change-explorer>
        <div className="ac-mono flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-1 px-4 py-1.5 text-nano text-text-3" data-change-meta>
          <span>#{number}</span>
          <span className="text-text-2">{pr?.headRefName ?? '…'} → {pr?.baseRefName ?? '…'}</span>
          {pr?.headSha ? <span title={pr.headSha}>head {pr.headSha.slice(0, 10)}</span> : null}
          <span className="text-done">+{totals.additions}</span>
          <span className="text-failed">−{totals.deletions}</span>
          <span>{files.length} {files.length === 1 ? 'file' : 'files'}</span>
          {pr ? <a href={pr.url} target="_blank" rel="noreferrer" className="v2-link ml-auto">open on the forge</a> : null}
        </div>

        {diffFiles.isLoading ? (
          <div className="p-4"><SkeletonRows rows={4} /></div>
        ) : !diffFiles.data || !diffFiles.data.available ? (
          <div className="p-4">
            <p className="text-meta text-text-3">{diffFiles.data?.reason ? UNAVAILABLE[diffFiles.data.reason] : UNAVAILABLE.unreachable}</p>
          </div>
        ) : files.length === 0 ? (
          <div className="p-4"><p className="text-meta text-text-3">The forge reported no changed files.</p></div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
            {(!phone || !requested) ? (
              <ChangeTree
                nodes={tree}
                query={query}
                onQuery={setQuery}
                collapsed={collapsed}
                onToggleFolder={(path) => setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(path)) next.delete(path); else next.add(path);
                  return next;
                })}
                selectedPath={selected?.path ?? null}
                onSelect={openFile}
                onKeyDown={onKeyDown}
                className={cx(phone ? 'min-h-0 flex-1 overflow-y-auto' : 'md:w-80 md:flex-none md:border-r md:border-line-1')}
              />
            ) : null}

            {(!phone || requested) ? (
              <FilePanel
                projectId={project.id}
                number={number}
                file={selected}
                mode={mode}
                onMode={setMode}
                layout={layout}
                onLayout={setLayout}
                phone={phone}
                onBack={clearFile}
                className="min-h-0 min-w-0 flex-1 overflow-y-auto"
              />
            ) : null}
          </div>
        )}
      </div>
    </V2Page>
  );
}

/** Files grouped into collapsible folders, with a filter and the selected file highlighted. */
function ChangeTree({
  nodes, query, onQuery, collapsed, onToggleFolder, selectedPath, onSelect, onKeyDown, className,
}: {
  nodes: ChangeNode[];
  query: string;
  onQuery: (q: string) => void;
  collapsed: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cx('flex min-w-0 flex-col', className)} data-change-tree>
      <div className="flex-none p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filter files…"
          aria-label="Filter files"
          className="h-8 w-full rounded-r4 border border-line-2 bg-bg-input px-2 text-meta text-text-1 outline-none placeholder:text-text-4 focus:border-accent-edge"
        />
      </div>
      <ul
        role="tree"
        aria-label="Changed files"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto pb-2 outline-none"
      >
        {nodes.length === 0 ? (
          <li className="px-3 py-2 text-meta text-text-3">No file matches that filter.</li>
        ) : (
          nodes.map((node) => (
            <TreeNode key={node.path} node={node} depth={0} collapsed={collapsed} onToggleFolder={onToggleFolder} selectedPath={selectedPath} onSelect={onSelect} />
          ))
        )}
      </ul>
    </div>
  );
}

function TreeNode({
  node, depth, collapsed, onToggleFolder, selectedPath, onSelect,
}: {
  node: ChangeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}): React.ReactElement {
  const pad = { paddingLeft: `${0.5 + depth * 0.75}rem` };
  if (node.kind === 'file') return <TreeFile node={node} pad={pad} selected={node.path === selectedPath} onSelect={onSelect} />;
  const isCollapsed = collapsed.has(node.path);
  return (
    <li role="treeitem" aria-expanded={!isCollapsed}>
      <button
        type="button"
        onClick={() => onToggleFolder(node.path)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-r4 py-1 pr-2 text-left hover:bg-bg-2"
        style={pad}
      >
        <span aria-hidden className={cx('flex-none text-nano text-text-4 transition-transform', isCollapsed ? '' : 'rotate-90')}>▸</span>
        <span className="min-w-0 flex-1 truncate text-meta text-text-2" title={node.path}>{node.name}</span>
        <span className="ac-mono flex-none text-nano text-done">+{node.additions}</span>
        <span className="ac-mono flex-none text-nano text-failed">−{node.deletions}</span>
      </button>
      {isCollapsed ? null : (
        <ul role="group">
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} collapsed={collapsed} onToggleFolder={onToggleFolder} selectedPath={selectedPath} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TreeFile({ node, pad, selected, onSelect }: { node: ChangeFile; pad: { paddingLeft: string }; selected: boolean; onSelect: (path: string) => void }): React.ReactElement {
  const file = node.file;
  return (
    <li role="treeitem" aria-selected={selected}>
      <button
        type="button"
        onClick={() => onSelect(file.path)}
        data-selected={selected ? 'true' : undefined}
        className={cx('flex w-full min-w-0 items-center gap-1.5 rounded-r4 py-1 pr-2 text-left', selected ? 'bg-accent-tint' : 'hover:bg-bg-2')}
        style={pad}
      >
        <span className={cx('v2-tag flex-none', STATUS_TONE[file.status])}>{file.status}</span>
        <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-2" title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}>
          {file.previousPath ? `${file.previousPath} → ${file.path}` : node.name}
        </span>
        <span className="ac-mono flex-none text-nano text-done">+{file.additions}</span>
        <span className="ac-mono flex-none text-nano text-failed">−{file.deletions}</span>
      </button>
    </li>
  );
}

/** One file's diff: whole file by default, changes-only on request, unified or side-by-side. */
function FilePanel({
  projectId, number, file, mode, onMode, layout, onLayout, phone, onBack, className,
}: {
  projectId: string;
  number: number;
  file: T.DiffFileSummary | null;
  mode: DiffMode;
  onMode: (m: DiffMode) => void;
  layout: DiffLayout;
  onLayout: (l: DiffLayout) => void;
  phone: boolean;
  onBack: () => void;
  className?: string;
}): React.ReactElement {
  if (!file) {
    return (
      <div className={cx('flex min-w-0 items-center justify-center p-8', className)}>
        <p className="text-meta text-text-3">Select a file to read its changes.</p>
      </div>
    );
  }
  const effectiveLayout: DiffLayout = phone ? 'unified' : layout;
  return (
    <div className={cx('flex min-w-0 flex-col', className)} data-file-panel>
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line-1 px-3 py-1.5">
        {phone ? (
          <button type="button" onClick={onBack} className="v2-link text-micro">← files</button>
        ) : null}
        <span className={cx('v2-tag', STATUS_TONE[file.status])}>{file.status}</span>
        <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-2" title={file.path}>
          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        </span>
        {!file.binary && !file.tooLarge ? (
          <div className="flex items-center gap-1.5">
            <Toggle on={mode === 'whole'} onClick={() => onMode('whole')} label="Whole file" />
            <Toggle on={mode === 'changes'} onClick={() => onMode('changes')} label="Changes only" />
          </div>
        ) : null}
        {!phone && !file.binary && !file.tooLarge ? (
          <div className="flex items-center gap-1.5">
            <Toggle on={effectiveLayout === 'unified'} onClick={() => onLayout('unified')} label="Unified" />
            <Toggle on={effectiveLayout === 'split'} onClick={() => onLayout('split')} label="Side-by-side" />
          </div>
        ) : null}
      </div>
      <div key={file.path} className="v2-anim-fade flex min-h-0 min-w-0 flex-1 flex-col">
        <FileDiff projectId={projectId} number={number} file={file} mode={mode} layout={effectiveLayout} />
      </div>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx('rounded-r4 border px-2 py-1 text-micro', on ? 'border-line-3 bg-bg-2 text-text-1' : 'border-line-2 text-text-3 hover:bg-bg-2')}
    >
      {label}
    </button>
  );
}

function FileDiff({ projectId, number, file, mode, layout }: { projectId: string; number: number; file: T.DiffFileSummary; mode: DiffMode; layout: DiffLayout }): React.ReactElement {
  const renderable = !file.binary && !file.tooLarge;
  // VS-445's highlighter: one grammar loaded per language, and the hook returns the stable
  // line-highlighter `Code`/`DiffHunks` expect, so no local `useCallback` wrapper is needed.
  const highlight = useHighlighter(languageForPath(file.path));

  const diffFile = usePullRequestDiffFile(projectId, number, renderable ? file.path : null);
  const basePath = file.previousPath ?? file.path;
  const wantBase = renderable && mode === 'whole';
  const base = usePullRequestDiffContext(projectId, number, wantBase ? basePath : null, wantBase ? { start: 1, end: WHOLE_FILE_END } : null);

  if (file.binary) return <div className="p-3"><p className="text-meta text-text-3">This file is binary.</p></div>;
  if (file.tooLarge) return <div className="p-3"><p className="text-meta text-text-3">This file's change is too large to render.</p></div>;
  if (diffFile.isLoading) return <div className="p-3"><SkeletonRows rows={4} /></div>;
  const data = diffFile.data;
  if (!data || !data.available) return <div className="p-3"><p className="text-meta text-text-3">{data?.reason ? UNAVAILABLE[data.reason] : UNAVAILABLE.unreachable}</p></div>;
  if (!data.file) return <div className="p-3"><p className="text-meta text-text-3">No content for this file.</p></div>;

  const content = data.file;
  if (content.hunks.length === 0) {
    return <div className="p-3"><p className="text-meta text-text-3">This file has no textual changes — it was renamed, or its change is empty.</p></div>;
  }

  if (mode === 'whole') {
    if (base.isLoading) return <div className="p-3"><SkeletonRows rows={6} /></div>;
    const hunk = wholeFileHunk(content, base.data?.lines ?? null);
    return (
      <div className="ac-diff-code ac-mono min-w-0 flex-1 overflow-auto text-nano">
        {layout === 'unified' ? <UnifiedHunk hunk={hunk} highlight={highlight} wrap={false} /> : <SplitHunk hunk={hunk} highlight={highlight} />}
      </div>
    );
  }

  return (
    <div className="ac-diff-code ac-mono min-w-0 flex-1 overflow-auto border-t border-line-1 text-nano">
      {content.hunks.map((hunk, i) => (
        <div key={`${hunk.oldStart}-${hunk.newStart}`}>
          {i > 0 ? <RegionGap projectId={projectId} number={number} path={file.path} prev={content.hunks[i - 1]!} next={hunk} highlight={highlight} /> : null}
          <div className="bg-bg-2 px-2.5 py-0.5 text-text-4">{hunk.header}</div>
          {layout === 'unified' ? <UnifiedHunk hunk={hunk} highlight={highlight} wrap={false} /> : <SplitHunk hunk={hunk} highlight={highlight} />}
        </div>
      ))}
    </div>
  );
}

/** The unchanged region between two hunks in changes-only mode — collapsed until asked for. */
function RegionGap({
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