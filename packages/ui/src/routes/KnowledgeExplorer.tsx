/**
 * A file-explorer style view over the knowledge base (VS-265, VS-279): a full-width two-pane
 * browser. The left pane is a folder tree built client-side from the same document catalogue and
 * hub list the flat "Knowledge" tab already fetches, with hub files shown as a distinguished node
 * rather than a folder and each scope's dated archive files collapsed out of the way. The right
 * pane shows the selected entry's content inline, reusing the existing `DocPanel`,
 * `KnowledgeDocPanel`, `ArchivePanel` and `ArtifactPanel` — this view adds no renderer of its own.
 *
 * Layout: `PageBody` already has a definite height, so the root is `h-full min-h-0` and each pane
 * owns its scrolling (`min-h-0 ac-scroll`). On a phone (`< md`) only one pane shows at a time.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { Badge } from '../components/StatusGlyph';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Markdown } from '../components/Markdown';
import { ArtifactViewer } from '../components/ArtifactViewer';
import {
  useKnowledgeArchiveFile, useKnowledgeArchiveMany, useKnowledgeDocs, useKnowledgeIndex, useProjects,
  useProjectArtifacts, useTicketDocumentRevisions, useWorkspaceArtifacts,
} from '../api/hooks';
import { useWs } from '../api/context';
import type { TicketArtifactSummary, WeaverArtifactSummary } from '../api/types';
import {
  buildExplorerTree, clampTreeWidth, parseDocParam, serializeDocParam, TREE_WIDTH_DEFAULT, TREE_WIDTH_MAX,
  TREE_WIDTH_MIN, type ExplorerHub, type ExplorerNode,
} from '../lib/knowledgeExplorer';
import { DocPanel, KnowledgeDocPanel, type DocRef } from './KnowledgeDocs';
import { cx } from '../lib/cx';
import { ago } from '../lib/format';
import { useGo, useSearchParams } from '../app/link';

interface HubOpen { scope: string; project?: string }

/** What the content pane shows. `null` means "nothing explicitly selected" — the default applies. */
type Selection =
  | { kind: 'doc'; ref: DocRef }
  | { kind: 'hub'; scope: string; project?: string }
  | { kind: 'archive'; scope: string; project?: string; path: string }
  | { kind: 'artifact'; artifact: TicketArtifactSummary };

/** A media query as a boolean that follows changes (same local-hook pattern as KnowledgeGraph). */
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

export function KnowledgeExplorer({ project }: { project?: string }): React.ReactElement {
  const ws = useWs();
  const url = useSearchParams();
  const go = useGo();
  const docs = useKnowledgeDocs(project);
  const index = useKnowledgeIndex();
  const projects = useProjects();
  const artifacts = useProjectArtifacts(project);
  // Workspace-scoped, never filtered by `project` (VS-297): a weaver artifact has no ticket, so no
  // project to scope it to either.
  const weaverArtifacts = useWorkspaceArtifacts();
  const narrow = useMediaQuery('(max-width: 767px)');
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [treeWidth, setTreeWidth] = useState(TREE_WIDTH_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(() => {
    const ref = parseDocParam(url['doc'], project);
    return ref ? { kind: 'doc', ref } : null;
  });

  // Adopt a `?doc=` from outside (a pasted link, back/forward) without fighting our own writes.
  const urlDoc = url['doc'];
  useEffect(() => {
    const parsed = parseDocParam(urlDoc, project);
    setSelection((prev) => {
      const current = prev?.kind === 'doc' ? serializeDocParam(prev.ref) : null;
      const next = parsed ? serializeDocParam(parsed) : null;
      if (current === next) return prev;
      if (parsed) return { kind: 'doc', ref: parsed };
      return prev?.kind === 'doc' ? null : prev;
    });
  }, [urlDoc, project]);

  const hubs: ExplorerHub[] = useMemo(
    () =>
      (index.data?.files ?? [])
        .filter((f) => f.kind !== 'doc' && (!project || !f.projectId || f.projectId === project))
        .map((f) => ({ scope: f.scope, projectId: f.projectId, projectSlug: f.projectSlug ?? null })),
    [index.data, project],
  );

  const visibleDocs = useMemo(() => (docs.data ?? []).filter((d) => !project || !d.projectId || d.projectId === project), [docs.data, project]);

  const tree = useMemo(() => buildExplorerTree(visibleDocs, hubs), [visibleDocs, hubs]);

  // Only `project` and `workspace` roots get an archive entry: `workspace`, `shared` and
  // `decisions` hubs all sit in the same `knowledge/workspace/` directory, so their archive files
  // are already one tree — showing it under all three roots would just repeat it (VS-265 design).
  const archiveRoots = useMemo(
    () => tree.filter((r) => r.children.some((c) => c.kind === 'hub' && (c.hub!.scope === 'project' || c.hub!.scope === 'workspace'))).map((r) => {
      const hub = r.children.find((c) => c.kind === 'hub')!.hub!;
      return { rootId: r.id, scope: hub.scope, ...(hub.project ? { project: hub.project } : {}) };
    }),
    [tree],
  );
  const archiveResults = useKnowledgeArchiveMany(archiveRoots);

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const writeUrl = (doc: string | null, projectId?: string): void => {
    const search: Record<string, unknown> = { tab: 'explorer' };
    const proj = projectId ?? url['project'];
    if (proj) search['project'] = proj;
    if (doc) search['doc'] = doc;
    go('/w/$ws/knowledge', { params: { ws }, search, replace: true });
  };

  const openDoc = (ref: DocRef): void => {
    setSelection({ kind: 'doc', ref });
    writeUrl(serializeDocParam(ref), ref.scope === 'project' ? ref.project : undefined);
  };
  const openHub = (hub: HubOpen): void => { setSelection({ kind: 'hub', ...hub }); writeUrl(null); };
  const openArchive = (scope: string, projectId: string | undefined, path: string): void => {
    setSelection({ kind: 'archive', scope, ...(projectId ? { project: projectId } : {}), path });
    writeUrl(null);
  };
  const openArtifact = (artifact: TicketArtifactSummary): void => { setSelection({ kind: 'artifact', artifact }); writeUrl(null); };
  const clearSelection = (): void => { setSelection(null); writeUrl(null); };

  // The content pane is never empty on desktop: with no explicit selection it shows the project's
  // PROJECT.md (falling back to the first project when "all" is selected). Computed rather than
  // stored, so a phone at rest still has `selection === null` and stays on the tree.
  const effectiveProject = project || projects.data?.[0]?.id;
  const shown: Selection | null = selection ?? (effectiveProject ? { kind: 'hub', scope: 'project', project: effectiveProject } : null);

  useEffect(() => {
    if (!dragging) return;
    const node = rootRef.current;
    if (!node) return;
    const move = (e: PointerEvent): void => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0) return;
      setTreeWidth(clampTreeWidth(((e.clientX - rect.left) / rect.width) * 100));
    };
    const end = (): void => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragging]);

  const onDividerKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setTreeWidth((w) => clampTreeWidth(w - 2)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setTreeWidth((w) => clampTreeWidth(w + 2)); }
  };

  const artifactRows = artifacts.data ?? [];
  const weaverArtifactRows = weaverArtifacts.data ?? [];

  if (docs.isLoading || index.isLoading) return <SkeletonRows rows={5} />;
  if (docs.isError || index.isError) return <ErrorState code="KNOWLEDGE_EXPLORER_FAILED" message="The knowledge base could not be read." onRetry={() => { void docs.refetch(); void index.refetch(); }} />;
  // A project with no documents/hubs but with artifacts still has something to browse (VS-270) — the
  // "nothing to browse" state only applies once artifacts have loaded and are also empty.
  if (!tree.length && !artifactRows.length && !weaverArtifactRows.length && !artifacts.isLoading && !weaverArtifacts.isLoading) {
    return <EmptyState title="Nothing to browse yet." detail="A knowledge base and its documents are created as soon as a worker or the weaver writes to them." />;
  }

  const activeNode = (node: ExplorerNode): boolean => {
    if (!selection) return false;
    if (node.kind === 'doc' && selection.kind === 'doc') {
      return node.doc!.scope === selection.ref.scope && node.doc!.slug === selection.ref.slug;
    }
    if (node.kind === 'hub' && selection.kind === 'hub') {
      return node.hub!.scope === selection.scope && node.hub!.project === selection.project;
    }
    return false;
  };

  const showTree = !narrow || selection === null;
  const showContent = !narrow || selection !== null;

  return (
    <div ref={rootRef} className="flex h-full min-h-0" style={{ '--tree-w': `${treeWidth}%` } as React.CSSProperties}>
      {showTree ? (
        <div className={cx('min-w-0 min-h-0 ac-scroll', narrow ? 'flex-1' : 'w-[var(--tree-w)] flex-none')}>
          <div className="ac-card divide-y divide-line-1">
            {tree.map((root) => {
              const archiveIdx = archiveRoots.findIndex((r) => r.rootId === root.id);
              const archive = archiveIdx >= 0 ? archiveResults[archiveIdx] : undefined;
              const archiveRoot = archiveIdx >= 0 ? archiveRoots[archiveIdx] : undefined;
              return (
                <RootSection
                  key={root.id}
                  root={root}
                  expanded={expanded}
                  onToggle={toggle}
                  onOpenDoc={openDoc}
                  onOpenHub={openHub}
                  isActive={activeNode}
                  archiveEntries={archive?.data}
                  archiveLoading={archive?.isLoading ?? false}
                  onOpenArchive={archiveRoot ? (path) => openArchive(archiveRoot.scope, archiveRoot.project, path) : undefined}
                />
              );
            })}
            {/* Flat, recency-ordered, not grouped by ticket or kind (design.md Decision 1) — omitted
                entirely, not shown empty, when the scope has no artifacts. */}
            {artifactRows.length ? (
              <ArtifactsSection artifacts={artifactRows} openId={selection?.kind === 'artifact' ? selection.artifact.id : null} onOpen={openArtifact} />
            ) : null}
            {/* A weaver artifact has no ticket to be scoped to, so it is its own peer entry here —
                never merged into the ticket-scoped Artifacts list above (design.md Decision 6). */}
            {weaverArtifactRows.length ? (
              <WeaverArtifactsSection artifacts={weaverArtifactRows} onOpen={(a) => go('/w/$ws/artifacts/$key', { params: { ws, key: a.key } })} />
            ) : null}
          </div>
        </div>
      ) : null}

      {!narrow ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize tree pane"
          aria-valuenow={Math.round(treeWidth)}
          aria-valuemin={TREE_WIDTH_MIN}
          aria-valuemax={TREE_WIDTH_MAX}
          tabIndex={0}
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); setDragging(true); }}
          onKeyDown={onDividerKeyDown}
          onDoubleClick={() => setTreeWidth(TREE_WIDTH_DEFAULT)}
          className="mx-1.5 w-1 flex-none cursor-col-resize touch-none select-none bg-line-1 hover:bg-accent"
        />
      ) : null}

      {showContent ? (
        <div className="min-w-0 min-h-0 flex-1 ac-scroll">
          {narrow && selection !== null ? (
            <button type="button" onClick={clearSelection} className="mb-2 flex items-center gap-1.5 px-0.5 text-meta text-text-2 hover:text-text-1">
              ← tree
            </button>
          ) : null}
          {shown ? (
            shown.kind === 'doc' ? (
              <DocPanel doc={shown.ref} projects={projects.data ?? []} onOpen={openDoc} onClose={clearSelection} />
            ) : shown.kind === 'hub' ? (
              <KnowledgeDocPanel scope={shown.scope} project={shown.project} onClose={clearSelection} onOpenDoc={openDoc} />
            ) : shown.kind === 'archive' ? (
              <ArchivePanel scope={shown.scope} project={shown.project} path={shown.path} onClose={clearSelection} />
            ) : (
              <ArtifactPanel ws={ws} artifact={shown.artifact} onClose={clearSelection} />
            )
          ) : (
            <div className="ac-card p-3.5 text-meta text-text-3">Select a document from the tree to read it here.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RootSection({
  root, expanded, onToggle, onOpenDoc, onOpenHub, isActive, archiveEntries, archiveLoading, onOpenArchive,
}: {
  root: ExplorerNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpenDoc: (ref: DocRef) => void;
  onOpenHub: (hub: HubOpen) => void;
  isActive: (node: ExplorerNode) => boolean;
  archiveEntries: Array<{ path: string; date: string }> | undefined;
  archiveLoading: boolean;
  onOpenArchive?: (path: string) => void;
}): React.ReactElement {
  return (
    <div>
      <div className="flex items-center gap-2 bg-bg-2 px-3.5 py-2">
        <span className="ac-mono text-nano uppercase tracking-wide text-text-4">{root.label}</span>
      </div>
      <div>
        {root.children.map((child) => (
          <TreeRow key={child.id} node={child} depth={0} expanded={expanded} onToggle={onToggle} onOpenDoc={onOpenDoc} onOpenHub={onOpenHub} isActive={isActive} />
        ))}
        {archiveEntries?.length ? (
          <ArchiveRow entries={archiveEntries} loading={archiveLoading} expanded={expanded} onToggle={onToggle} rootId={root.id} onOpen={onOpenArchive} />
        ) : null}
      </div>
    </div>
  );
}

function TreeRow({
  node, depth, expanded, onToggle, onOpenDoc, onOpenHub, isActive,
}: {
  node: ExplorerNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpenDoc: (ref: DocRef) => void;
  onOpenHub: (hub: HubOpen) => void;
  isActive: (node: ExplorerNode) => boolean;
}): React.ReactElement {
  const pad = { paddingLeft: `${0.875 + depth * 1.25}rem` };
  const active = isActive(node);

  if (node.kind === 'hub') {
    return (
      <button
        type="button"
        style={pad}
        onClick={() => onOpenHub(node.hub!)}
        aria-current={active ? 'true' : undefined}
        className={cx('flex w-full items-center gap-2 py-1.5 pr-3.5 text-left hover:bg-bg-2', active && 'bg-accent-tint')}
      >
        <HubGlyph />
        <span className="text-meta font-medium text-text-1">{node.label}</span>
        <Badge tone="neutral">hub</Badge>
      </button>
    );
  }

  if (node.kind === 'folder') {
    const open = expanded.has(node.id);
    return (
      <div>
        <button
          type="button"
          style={pad}
          onClick={() => onToggle(node.id)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 py-1.5 pr-3.5 text-left hover:bg-bg-2"
        >
          <Chevron open={open} />
          <FolderGlyph />
          <span className="ac-mono text-meta text-text-2">{node.label}</span>
          <span className="text-nano text-text-4">{node.children.length}</span>
        </button>
        {open ? node.children.map((c) => <TreeRow key={c.id} node={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpenDoc={onOpenDoc} onOpenHub={onOpenHub} isActive={isActive} />) : null}
      </div>
    );
  }

  const d = node.doc!;
  return (
    <button
      type="button"
      style={pad}
      onClick={() => onOpenDoc({ scope: d.scope, slug: d.slug, ...(d.projectId ? { project: d.projectId } : {}) })}
      aria-current={active ? 'true' : undefined}
      className={cx('flex w-full items-center gap-2.5 py-1.5 pr-3.5 text-left hover:bg-bg-2', active && 'bg-accent-tint')}
    >
      <DocGlyph />
      <span className="min-w-0 flex-1 truncate text-meta text-text-1">{node.label}</span>
      {d.backlinks === 0 ? <Badge tone="modified">orphan</Badge> : null}
      <span className="ac-mono flex-none text-nano text-text-4">{d.links}→ ←{d.backlinks}</span>
    </button>
  );
}

function ArchiveRow({
  entries, loading, expanded, onToggle, rootId, onOpen,
}: {
  entries: Array<{ path: string; date: string }>;
  loading: boolean;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  rootId: string;
  onOpen?: (path: string) => void;
}): React.ReactElement {
  const id = `${rootId}#archive`;
  const open = expanded.has(id);
  return (
    <div>
      <button
        type="button"
        style={{ paddingLeft: '0.875rem' }}
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-1.5 pr-3.5 text-left hover:bg-bg-2"
      >
        <Chevron open={open} />
        <span className="ac-mono text-meta text-text-3">archive</span>
        <span className="text-nano text-text-4">{loading ? '…' : entries.length}</span>
      </button>
      {open
        ? entries.map((e) => (
            <button
              key={e.path}
              type="button"
              style={{ paddingLeft: '2.125rem' }}
              onClick={() => onOpen?.(e.path)}
              className="ac-mono flex w-full items-center gap-2 py-1.5 pr-3.5 text-left text-micro text-text-3 hover:bg-bg-2"
            >
              {e.date}
            </button>
          ))
        : null}
    </div>
  );
}

function ArchivePanel({ scope, project, path, onClose }: { scope: string; project?: string; path: string; onClose: () => void }): React.ReactElement {
  const file = useKnowledgeArchiveFile(scope, path, project);
  return (
    <section className="ac-card">
      <header className="flex items-center gap-2 border-b border-line-1 px-3.5 py-2.5">
        <span className="ac-mono text-micro text-text-2">{path}</span>
        <Badge tone="neutral">read-only</Badge>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </header>
      <div className="p-3.5">
        {file.isLoading ? <SkeletonRows rows={4} /> : <Markdown source={file.data?.body ?? ''} />}
      </div>
    </section>
  );
}

/**
 * The Artifacts entry (VS-270): a flat list across every ticket in scope, sorted most-recently-updated
 * first (server-side; not re-sorted here — see design.md Decision 1 for why this is flat rather than
 * grouped by ticket or kind).
 */
function ArtifactsSection({
  artifacts, openId, onOpen,
}: {
  artifacts: TicketArtifactSummary[];
  openId: string | null;
  onOpen: (artifact: TicketArtifactSummary) => void;
}): React.ReactElement {
  return (
    <div>
      <div className="flex items-center gap-2 bg-bg-2 px-3.5 py-2">
        <span className="ac-mono text-nano uppercase tracking-wide text-text-4">Artifacts</span>
      </div>
      <div>
        {artifacts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a)}
            style={{ paddingLeft: '0.875rem' }}
            className={cx('flex w-full items-center gap-2.5 py-1.5 pr-3.5 text-left hover:bg-bg-2', a.id === openId && 'bg-bg-2')}
          >
            <ArtifactGlyph />
            <span className="min-w-0 flex-1 truncate text-meta text-text-1">{a.title ?? a.key}</span>
            {typeof a.metadata['kind'] === 'string' ? <Badge tone="neutral">{a.metadata['kind'] as string}</Badge> : null}
            <span className="ac-mono flex-none text-nano text-text-4">{a.ticketIdentifier}</span>
            <span className="ac-mono flex-none text-nano text-text-4">{ago(a.updatedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The weaver's own workspace-scoped artifacts (VS-297): a peer entry to `ArtifactsSection` above,
 * never merged into it — a weaver artifact carries no ticket identifier to show. Selecting a row
 * navigates to its standalone `/w/:ws/artifacts/:key` page (the same one `weave_artifact_put`'s
 * returned URL opens) rather than opening a second inline viewer here.
 */
function WeaverArtifactsSection({
  artifacts, onOpen,
}: {
  artifacts: WeaverArtifactSummary[];
  onOpen: (artifact: WeaverArtifactSummary) => void;
}): React.ReactElement {
  return (
    <div>
      <div className="flex items-center gap-2 bg-bg-2 px-3.5 py-2">
        <span className="ac-mono text-nano uppercase tracking-wide text-text-4">Weaver Artifacts</span>
      </div>
      <div>
        {artifacts.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => onOpen(a)}
            style={{ paddingLeft: '0.875rem' }}
            className="flex w-full items-center gap-2.5 py-1.5 pr-3.5 text-left hover:bg-bg-2"
          >
            <ArtifactGlyph />
            <span className="min-w-0 flex-1 truncate text-meta text-text-1">{a.title ?? a.key}</span>
            {a.kind ? <Badge tone="neutral">{a.kind}</Badge> : null}
            <span className="ac-mono flex-none text-nano text-text-4">{ago(a.updatedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ArtifactPanel({ ws, artifact, onClose }: { ws: string; artifact: TicketArtifactSummary; onClose: () => void }): React.ReactElement {
  const revisions = useTicketDocumentRevisions(artifact.ticketId, `artifact:${artifact.key}`);
  return (
    <section className="ac-card">
      <header className="flex items-center gap-2 border-b border-line-1 px-3.5 py-2.5">
        <span className="text-meta font-medium text-text-1">{artifact.title ?? artifact.key}</span>
        <Badge tone="neutral">{artifact.ticketIdentifier}</Badge>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </header>
      <div className="p-3.5">
        <ArtifactViewer ws={ws} ticketId={artifact.ticketId} artifact={{ key: artifact.key, title: artifact.title, url: artifact.url ?? '' }} revisions={revisions.data} />
      </div>
    </section>
  );
}

function ArtifactGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 flex-none text-text-4" aria-hidden>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M4.5 6h7M4.5 8.5h7M4.5 11h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 8 8" className={cx('size-2 flex-none text-text-4 transition-transform duration-(--dur-fast) ease-ac', open && 'rotate-90')} aria-hidden>
      <path d="M2.5 1 6 4 2.5 7Z" fill="currentColor" />
    </svg>
  );
}

function FolderGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 flex-none text-accent" aria-hidden>
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.17a1.5 1.5 0 0 1 1.06.44L7.56 3.3a.5.5 0 0 0 .35.15H13.5A1.5 1.5 0 0 1 15 5v7.5A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5Z" fill="currentColor" fillOpacity="0.85" />
    </svg>
  );
}

function DocGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 flex-none text-text-4" aria-hidden>
      <path d="M4 1.5h5.5L13 5v9a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 14V3a1.5 1.5 0 0 1 1-1.5Z" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M9.5 1.5V5H13" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function HubGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 flex-none text-working" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}
