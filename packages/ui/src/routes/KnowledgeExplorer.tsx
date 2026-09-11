/**
 * A file-explorer style view over the knowledge base (VS-265): a folder tree built client-side
 * from the same document catalogue and hub list the flat "Knowledge" tab already fetches, with
 * hub files shown as a distinguished node rather than a folder, and each scope's dated archive
 * files reachable but collapsed out of the way. Opening a document or a hub reuses the existing
 * `DocPanel`/`KnowledgeDocPanel` — this view adds no new read/write UI of its own.
 */
import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { Badge } from '../components/StatusGlyph';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Markdown } from '../components/Markdown';
import {
  useKnowledgeArchiveFile, useKnowledgeArchiveMany, useKnowledgeDocs, useKnowledgeIndex, useProjects,
} from '../api/hooks';
import { buildExplorerTree, type ExplorerHub, type ExplorerNode } from '../lib/knowledgeExplorer';
import { DocPanel, KnowledgeDocPanel, type DocRef } from './KnowledgeDocs';
import { cx } from '../lib/cx';

interface HubOpen { scope: string; project?: string }

export function KnowledgeExplorer({ project }: { project?: string }): React.ReactElement {
  const docs = useKnowledgeDocs(project);
  const index = useKnowledgeIndex();
  const projects = useProjects();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [openDoc, setOpenDoc] = useState<DocRef | null>(null);
  const [openHub, setOpenHub] = useState<HubOpen | null>(null);
  const [openArchive, setOpenArchive] = useState<{ scope: string; project?: string; path: string } | null>(null);

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

  if (docs.isLoading || index.isLoading) return <SkeletonRows rows={5} />;
  if (docs.isError || index.isError) return <ErrorState code="KNOWLEDGE_EXPLORER_FAILED" message="The knowledge base could not be read." onRetry={() => { void docs.refetch(); void index.refetch(); }} />;
  if (!tree.length) return <EmptyState title="Nothing to browse yet." detail="A knowledge base and its documents are created as soon as a worker or the conductor writes to them." />;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
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
              onOpenDoc={(ref) => { setOpenHub(null); setOpenArchive(null); setOpenDoc(ref); }}
              onOpenHub={(hub) => { setOpenDoc(null); setOpenArchive(null); setOpenHub(hub); }}
              archiveEntries={archive?.data}
              archiveLoading={archive?.isLoading ?? false}
              onOpenArchive={archiveRoot ? (path) => { setOpenDoc(null); setOpenHub(null); setOpenArchive({ scope: archiveRoot.scope, project: archiveRoot.project, path }); } : undefined}
            />
          );
        })}
      </div>

      {openDoc ? (
        <DocPanel
          doc={openDoc}
          projects={projects.data ?? []}
          onOpen={(ref) => { setOpenHub(null); setOpenArchive(null); setOpenDoc(ref); }}
          onClose={() => setOpenDoc(null)}
        />
      ) : null}
      {openHub ? (
        <KnowledgeDocPanel
          scope={openHub.scope}
          project={openHub.project}
          onClose={() => setOpenHub(null)}
          onOpenDoc={(ref) => { setOpenHub(null); setOpenDoc(ref); }}
        />
      ) : null}
      {openArchive ? <ArchivePanel scope={openArchive.scope} project={openArchive.project} path={openArchive.path} onClose={() => setOpenArchive(null)} /> : null}
    </div>
  );
}

function RootSection({
  root, expanded, onToggle, onOpenDoc, onOpenHub, archiveEntries, archiveLoading, onOpenArchive,
}: {
  root: ExplorerNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpenDoc: (ref: DocRef) => void;
  onOpenHub: (hub: HubOpen) => void;
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
          <TreeRow key={child.id} node={child} depth={0} expanded={expanded} onToggle={onToggle} onOpenDoc={onOpenDoc} onOpenHub={onOpenHub} />
        ))}
        {archiveEntries?.length ? (
          <ArchiveRow entries={archiveEntries} loading={archiveLoading} expanded={expanded} onToggle={onToggle} rootId={root.id} onOpen={onOpenArchive} />
        ) : null}
      </div>
    </div>
  );
}

function TreeRow({
  node, depth, expanded, onToggle, onOpenDoc, onOpenHub,
}: {
  node: ExplorerNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpenDoc: (ref: DocRef) => void;
  onOpenHub: (hub: HubOpen) => void;
}): React.ReactElement {
  const pad = { paddingLeft: `${0.875 + depth * 1.25}rem` };

  if (node.kind === 'hub') {
    return (
      <button
        type="button"
        style={pad}
        onClick={() => onOpenHub(node.hub!)}
        className="flex w-full items-center gap-2 py-1.5 pr-3.5 text-left hover:bg-bg-2"
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
        {open ? node.children.map((c) => <TreeRow key={c.id} node={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpenDoc={onOpenDoc} onOpenHub={onOpenHub} />) : null}
      </div>
    );
  }

  const d = node.doc!;
  return (
    <button
      type="button"
      style={pad}
      onClick={() => onOpenDoc({ scope: d.scope, slug: d.slug, ...(d.projectId ? { project: d.projectId } : {}) })}
      className="flex w-full items-center gap-2.5 py-1.5 pr-3.5 text-left hover:bg-bg-2"
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
