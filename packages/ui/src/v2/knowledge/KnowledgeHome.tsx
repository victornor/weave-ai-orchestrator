/**
 * The V2 Knowledge tab (VS-371, formerly the whole Knowledge home from VS-347): one search across
 * knowledge and specs, every workspace and project knowledge base as a row with its meter, the
 * linked-document catalogue V1's `DocsPanel` renders, and the artifacts workers published.
 *
 * The specs list moved to its own tab (see `KnowledgeSpecs.tsx`), so this page no longer mixes it in.
 * Reads every fact through V1's `api/hooks` and reuses V1's leaf viewers (`KnowledgeDocPanel`,
 * `DocsPanel`); the chrome is built from the V2 classes in `v2.css` and the Tailwind token utilities,
 * which resolve against the Mono tokens under `.v2-root`.
 */
import { useMemo, useState } from 'react';
import { A } from '../../app/link';
import { useWs } from '../../api/context';
import {
  useKnowledgeIndex,
  useProjects,
  useProjectArtifacts,
  useSearch,
  useTicketDocumentRevisions,
  useWorkspaceArtifacts,
} from '../../api/hooks';
import { ArtifactViewer } from '../../components/ArtifactViewer';
import { Badge } from '../../components/StatusGlyph';
import type { Project, SearchHit, TicketArtifactSummary } from '../../api/types';
import { ago } from '../../lib/format';
import { cx } from '../../lib/cx';
import { projectColorVar } from '../../lib/projectColor';
import { projectLabelFor } from '../../lib/projectName';
import { DocsPanel, KnowledgeDocPanel, type DocRef } from '../../routes/KnowledgeDocs';
import { useProjectScope } from './KnowledgeFrame';
import { Empty, Skeleton } from './KnowledgeParts';

/** A hub row from `useKnowledgeIndex`, with the project facts its label and hue need. */
interface Base {
  key: string;
  scope: string;
  projectId?: string;
  name: string;
  kindLabel: string;
  hue: string | null;
  used: number;
  budget: number;
  lastCuratedAt: string | null;
  curationPending: boolean;
  dueInDays: number | null;
}

export function KnowledgeHome(): React.ReactElement {
  const index = useKnowledgeIndex();
  const projects = useProjects();
  const projectList = projects.data ?? [];
  const project = useProjectScope();

  const [query, setQuery] = useState('');
  const [openBase, setOpenBase] = useState<Base | null>(null);
  const [openDoc, setOpenDoc] = useState<DocRef | null>(null);

  const siblingIds = useMemo(() => projectList.map((p) => p.id), [projectList]);
  // V1's rule: with a project selected, show the workspace hubs and that project's own hub; with
  // none, show every hub.
  const bases = useMemo<Base[]>(() => {
    const files = (index.data?.files ?? []).filter((f) => f.kind !== 'doc' && (!project || !f.projectId || f.projectId === project));
    return files.map((f) => {
      const basename = f.path.split('/').pop() ?? f.path;
      const projectId = f.scope === 'project' ? f.projectId : null;
      return {
        key: f.id,
        scope: f.scope,
        ...(projectId ? { projectId } : {}),
        name: projectId ? (projectLabelFor(projectList, { id: projectId, slug: f.projectSlug }) ?? 'project') : basename,
        kindLabel: projectId ? ' · project' : ` · ${f.scope}`,
        hue: projectId ? projectColorVar(projectId, siblingIds) : null,
        used: f.tokenEstimate,
        budget: f.budgetTokens,
        lastCuratedAt: f.lastCuratedAt,
        curationPending: f.curationPending,
        dueInDays: f.curationDueInDays ?? null,
      };
    });
  }, [index.data, projectList, siblingIds, project]);

  const searching = query.trim().length > 1;
  const hits = useSearch(query, undefined);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 md:p-5">
      <label className="flex items-center gap-2 rounded-r6 border border-line-2 bg-bg-input px-3 py-2">
        <SearchGlyph />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search knowledge, specs and artifacts…"
          aria-label="Search knowledge, specs and artifacts"
          className="min-w-0 flex-1 bg-transparent text-ui text-text-1 outline-none placeholder:text-text-3"
        />
      </label>

      {searching ? (
        <SearchResults hits={hits.data ?? []} loading={hits.isLoading} projects={projectList} />
      ) : (
        <>
          <BasesSection bases={bases} loading={index.isLoading} onOpen={setOpenBase} />
          <DocsPanel project={project || undefined} open={openDoc} onOpen={(ref) => { setOpenBase(null); setOpenDoc(ref); }} />
          <ArtifactsSection />
        </>
      )}

      {openBase ? (
        <KnowledgeDocPanel
          scope={openBase.scope}
          project={openBase.projectId}
          onClose={() => setOpenBase(null)}
          onOpenDoc={(ref) => { setOpenBase(null); setOpenDoc(ref); }}
        />
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="ac-label mb-2">{children}</div>;
}

function SearchGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 flex-none text-text-3" aria-hidden>
      <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.2 9.2 12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchResults({ hits, loading, projects }: { hits: SearchHit[]; loading: boolean; projects: Project[] }): React.ReactElement {
  if (loading) return <Skeleton />;
  if (!hits.length) return <Empty title="Nothing matches." detail="Try a requirement phrase, a capability name, or a stable word from a knowledge page." />;
  return (
    <div className="divide-y divide-line-1 border-y border-line-1">
      {hits.map((h, i) => (
        <div key={i} className="flex items-start gap-3 py-2.5">
          <Badge tone={h.kind === 'change' ? 'modified' : h.kind === 'requirement' ? 'added' : 'neutral'}>{h.kind}</Badge>
          <div className="min-w-0 flex-1">
            <div className="text-meta text-text-1">{h.title}</div>
            {h.subtitle ? <div className="ac-mono mt-0.5 text-micro text-text-3">{h.subtitle}</div> : null}
          </div>
          {h.projectSlug || h.projectId ? (
            <span className="flex-none text-nano text-text-3">{projectLabelFor(projects, { id: h.projectId, slug: h.projectSlug }) ?? ''}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function BasesSection({ bases, loading, onOpen }: { bases: Base[]; loading: boolean; onOpen: (b: Base) => void }): React.ReactElement {
  return (
    <section>
      <SectionLabel>Knowledge bases</SectionLabel>
      {loading ? (
        <Skeleton />
      ) : bases.length === 0 ? (
        <Empty title="No knowledge bases yet." detail="They are created with the workspace and each project." />
      ) : (
        <div className="border-t border-line-1">
          {bases.map((b) => {
            const ratio = b.budget > 0 ? Math.min(1, b.used / b.budget) : 0;
            const due = b.curationPending || ratio >= 0.9;
            return (
              <button key={b.key} type="button" onClick={() => onOpen(b)} className="block w-full border-b border-line-1 py-3 text-left">
                <div className="mb-2 flex items-center gap-2">
                  <span className="size-[9px] flex-none rounded-[2px]" style={{ background: b.hue ?? 'var(--accent)' }} aria-hidden />
                  <span className="text-ui font-medium" style={b.hue ? { color: b.hue } : undefined}>{b.name}</span>
                  <span className="text-ui text-text-3">{b.kindLabel}</span>
                  <span className={cx('ac-mono ml-auto text-nano', due ? 'text-working' : 'text-text-3')}>
                    {fmt(b.used)} / {fmt(b.budget)} tok
                  </span>
                </div>
                <div className="mb-1.5 h-1 overflow-hidden rounded-r4 bg-bg-3" role="meter" aria-valuenow={b.used} aria-valuemin={0} aria-valuemax={b.budget} aria-label={`${b.name} budget`}>
                  <div className={cx('h-full', due ? 'bg-working' : 'bg-accent')} style={{ width: `${Math.round(ratio * 100)}%` }} />
                </div>
                <div className="ac-mono text-nano text-text-2">
                  {due ? 'curation due' : b.lastCuratedAt ? `curated ${ago(b.lastCuratedAt)} ago` : 'never curated'}
                  {!due && b.dueInDays != null ? ` · next in ${b.dueInDays}d` : ''}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function fmt(n: number): string {
  // `16k`, not `16.0k`: the design shows whole thousands bare and only keeps a decimal where there is one.
  return n >= 1000 ? `${Number((n / 1000).toFixed(1))}k` : String(n);
}

function ArtifactsSection(): React.ReactElement {
  const ws = useWs();
  // Every project's ticket artifacts (no `project` argument — Knowledge is workspace-scoped), plus the
  // weaver's workspace-scoped ones. A ticket artifact opens inline, as V1's explorer does: its raw
  // route lives under its ticket (`/tickets/:id/artifacts/:key/raw`), not under `/artifacts/:key`,
  // which serves only workspace artifacts.
  const ticketArtifacts = useProjectArtifacts();
  const weaverArtifacts = useWorkspaceArtifacts();
  const [open, setOpen] = useState<TicketArtifactSummary | null>(null);
  const ticketRows = (ticketArtifacts.data ?? []).filter((a) => a.previewable);
  const weaverRows = weaverArtifacts.data ?? [];

  if (ticketRows.length === 0 && weaverRows.length === 0 && !ticketArtifacts.isLoading && !weaverArtifacts.isLoading) {
    return (
      <section>
        <SectionLabel>Artifacts · published by workers</SectionLabel>
        <Empty title="No artifacts yet." detail="A worker publishes one to a ticket; a weaver can publish one to the workspace." />
      </section>
    );
  }
  return (
    <section>
      <SectionLabel>Artifacts · published by workers</SectionLabel>
      <div className="border-t border-line-1">
        {ticketRows.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setOpen(a)}
            className="flex w-full items-center gap-2.5 border-b border-line-1 py-2.5 text-left hover:bg-bg-1"
          >
            <ArtifactGlyph />
            <span className="min-w-0 flex-1 truncate text-ui text-text-1">{a.title ?? a.key}</span>
            <span className="ac-mono flex-none text-nano text-text-3">{a.ticketIdentifier} · {ago(a.updatedAt)}</span>
          </button>
        ))}
        {weaverRows.map((a) => (
          <A
            key={a.key}
            to="/v2/w/$ws/artifacts/$key"
            params={{ ws, key: a.key }}
            className="flex items-center gap-2.5 border-b border-line-1 py-2.5 text-left hover:bg-bg-1"
          >
            <ArtifactGlyph />
            <span className="min-w-0 flex-1 truncate text-ui text-text-1">{a.title ?? a.key}</span>
            <span className="ac-mono flex-none text-nano text-text-3">{a.kind ?? 'artifact'} · {ago(a.updatedAt)}</span>
          </A>
        ))}
      </div>
      {open ? <TicketArtifactPanel ws={ws} artifact={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

/** A ticket artifact opened in place, the way V1's explorer `ArtifactPanel` does — same `ArtifactViewer`,
 *  same revision source (`artifact:<key>` on the ticket). */
function TicketArtifactPanel({ ws, artifact, onClose }: { ws: string; artifact: TicketArtifactSummary; onClose: () => void }): React.ReactElement {
  const revisions = useTicketDocumentRevisions(artifact.ticketId, `artifact:${artifact.key}`);
  return (
    <section className="v2-card mt-3">
      <header className="flex items-center gap-2 border-b border-line-1 px-3.5 py-2.5">
        <span className="text-meta font-medium text-text-1">{artifact.title ?? artifact.key}</span>
        <Badge tone="neutral">{artifact.ticketIdentifier}</Badge>
        <div className="flex-1" />
        <button type="button" onClick={onClose} className="text-meta text-text-3 hover:text-text-1">
          Close
        </button>
      </header>
      <div className="p-3.5">
        <ArtifactViewer
          ws={ws}
          ticketId={artifact.ticketId}
          artifact={{ key: artifact.key, title: artifact.title, url: artifact.url ?? '' }}
          revisions={revisions.data}
        />
      </div>
    </section>
  );
}

function ArtifactGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 flex-none text-accent-link" aria-hidden>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M4.5 6h7M4.5 8.5h7M4.5 11h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
