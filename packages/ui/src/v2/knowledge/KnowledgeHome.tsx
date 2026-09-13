/**
 * The V2 Knowledge home (VS-347): one search across knowledge and specs for the current workspace,
 * a kind filter row, every workspace and project knowledge base as a row with its meter, the spec
 * capability and change pages, and the artifacts workers published.
 *
 * Reads every fact through V1's `api/hooks` and reuses V1's leaf viewers (`KnowledgeDocPanel`,
 * `DocPanel`, `Markdown`, `Badge`); the chrome is built from the V2 classes in `v2.css` and the
 * Tailwind token utilities, which resolve against the Mono tokens under `.v2-root`.
 */
import { useEffect, useMemo, useState } from 'react';
import { A, useGo, useSearchParams } from '../../app/link';
import { useWs } from '../../api/context';
import {
  useCapabilities,
  useCapability,
  useKnowledgeIndex,
  useProjects,
  useProjectArtifacts,
  useSearch,
  useSpecChange,
  useSpecChanges,
  useTicketDocumentRevisions,
  useWorkspaceArtifacts,
} from '../../api/hooks';
import { Markdown } from '../../components/Markdown';
import { ArtifactViewer } from '../../components/ArtifactViewer';
import { Badge } from '../../components/StatusGlyph';
import type { CapabilitySummary, Project, SearchHit, SpecChangeSummary, TicketArtifactSummary } from '../../api/types';
import { ago } from '../../lib/format';
import { cx } from '../../lib/cx';
import { projectColorVar } from '../../lib/projectColor';
import { projectLabelFor } from '../../lib/projectName';
import { DocPanel, KnowledgeDocPanel, type DocRef } from '../../routes/KnowledgeDocs';

type Filter = 'everything' | 'knowledge' | 'specs' | 'artifacts';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'everything', label: 'Everything' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'specs', label: 'Specs' },
  { key: 'artifacts', label: 'Artifacts' },
];

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
  const url = useSearchParams();
  const ws = useWs();
  const go = useGo();
  const index = useKnowledgeIndex();
  const projects = useProjects();
  const projectList = projects.data ?? [];

  const [project, setProject] = useState<string>(url['project'] ?? '');
  useEffect(() => {
    setProject(url['project'] ?? '');
  }, [url['project']]);
  const activeProject = project || projectList[0]?.id || '';
  // The spec project picker is mirrored into `?project=` (as V1's Knowledge and the board do), so the
  // choice survives a reload and a link can arrive on a project.
  const pickProject = (id: string): void => {
    setProject(id);
    go('/v2/w/$ws/knowledge', { params: { ws }, search: { project: id }, replace: true });
  };

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('everything');
  const [openBase, setOpenBase] = useState<Base | null>(null);
  const [openDoc, setOpenDoc] = useState<DocRef | null>(null);
  const [capability, setCapability] = useState<string | null>(null);
  const [change, setChange] = useState<string | null>(null);

  const siblingIds = useMemo(() => projectList.map((p) => p.id), [projectList]);
  const bases = useMemo<Base[]>(() => {
    const files = (index.data?.files ?? []).filter((f) => f.kind !== 'doc');
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
  }, [index.data, projectList, siblingIds]);

  const searching = query.trim().length > 1;
  const hits = useSearch(query, undefined);

  // A search result never carries an artifact kind, so that chip always shows the artifacts list.
  const showKnowledge = filter === 'everything' || filter === 'knowledge';
  const showSpecs = filter === 'everything' || filter === 'specs';
  const showArtifacts = filter === 'everything' || filter === 'artifacts';

  if (change && activeProject) {
    return (
      <Body>
        <ChangePage project={activeProject} name={change} onBack={() => setChange(null)} />
      </Body>
    );
  }
  if (capability && activeProject) {
    return (
      <Body>
        <CapabilityPage project={activeProject} capability={capability} onBack={() => setCapability(null)} onOpenChange={setChange} />
      </Body>
    );
  }

  return (
    <Body>
      <div className="flex flex-col gap-3">
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
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cx('v2-tag', filter === f.key ? 'text-accent-link' : 'text-text-3')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {searching ? (
        <SearchResults
          hits={(hits.data ?? []).filter((h) => (filter === 'knowledge' ? h.kind === 'knowledge' : filter === 'specs' ? h.kind !== 'knowledge' : true))}
          loading={hits.isLoading}
          projects={projectList}
        />
      ) : (
        <>
          {showKnowledge ? <BasesSection bases={bases} loading={index.isLoading} onOpen={setOpenBase} /> : null}
          {showArtifacts ? <ArtifactsSection /> : null}
          {showSpecs ? <SpecsSection project={activeProject} projects={projectList} onPickProject={pickProject} onOpenCapability={setCapability} onOpenChange={setChange} /> : null}
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
      {openDoc ? <DocPanel doc={openDoc} projects={projectList} onOpen={setOpenDoc} onClose={() => setOpenDoc(null)} /> : null}
    </Body>
  );
}

function Body({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 md:p-5">{children}</div>;
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

function SpecsSection({
  project,
  projects,
  onPickProject,
  onOpenCapability,
  onOpenChange,
}: {
  project: string;
  projects: Project[];
  onPickProject: (id: string) => void;
  onOpenCapability: (c: string) => void;
  onOpenChange: (c: string) => void;
}): React.ReactElement {
  const capabilities = useCapabilities(project);
  const changes = useSpecChanges(project);
  const active = projects.find((p) => p.id === project);

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className="ac-label">Capabilities{active ? ` · ${active.name}` : ''}</span>
        {projects.length > 1 ? (
          <select
            value={project}
            onChange={(e) => onPickProject(e.target.value)}
            aria-label="Project"
            className="ac-mono ml-auto h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {!project ? (
        <Empty title="No project selected." detail="Pick a project to browse its specs." />
      ) : capabilities.isLoading ? (
        <Skeleton />
      ) : capabilities.isError ? (
        <Empty title="The spec index is unavailable." detail="It has not been built for this project yet." />
      ) : (capabilities.data?.length ?? 0) === 0 ? (
        <Empty title="No capabilities yet." detail="They appear once a change is archived into the main specs." />
      ) : (
        <div className="border-y border-line-1 bg-line-1">
          {(capabilities.data ?? []).map((c: CapabilitySummary) => (
            <button key={c.capability} type="button" onClick={() => onOpenCapability(c.capability)} className="flex w-full items-center gap-2.5 bg-bg-0 px-2 py-2.5 text-left hover:bg-bg-1">
              <span className="ac-mono flex-1 text-meta text-text-1">{c.capability}</span>
              {c.pendingChanges.length ? <span className="v2-tag text-accent-link">{c.pendingChanges.map((p) => p.ticketIdentifier ?? p.changeName).join(' · ')}</span> : null}
              <span className="ac-mono text-nano text-text-2">{c.requirementCount} reqs</span>
            </button>
          ))}
        </div>
      )}

      {(changes.data?.length ?? 0) > 0 ? (
        <div className="mt-4">
          <SectionLabel>Changes</SectionLabel>
          <div className="border-y border-line-1">
            {(changes.data ?? []).map((c: SpecChangeSummary) => (
              <button key={c.changeName} type="button" onClick={() => onOpenChange(c.changeName)} className="flex w-full items-center gap-2.5 border-b border-line-1 px-2 py-2.5 text-left hover:bg-bg-1">
                <Badge tone={c.state === 'active' ? 'modified' : 'neutral'}>{c.state}</Badge>
                <span className="ac-mono min-w-0 flex-1 truncate text-meta text-text-1">{c.changeName}</span>
                {c.taskProgress ? <span className="ac-mono text-nano text-text-3">{c.taskProgress.done}/{c.taskProgress.total} tasks</span> : null}
                {c.ticketIdentifier ? <span className="ac-mono text-nano text-text-3">{c.ticketIdentifier}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const DELTA_TONE = { ADDED: 'added', MODIFIED: 'modified', REMOVED: 'removed', RENAMED: 'modified' } as const;

function BackLink({ label, onClick }: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <button type="button" onClick={onClick} className="text-meta text-text-3 hover:text-text-1">
      ← {label}
    </button>
  );
}

function CapabilityPage({ project, capability, onBack, onOpenChange }: { project: string; capability: string; onBack: () => void; onOpenChange: (name: string) => void }): React.ReactElement {
  const detail = useCapability(project, capability);
  if (detail.isLoading) return <Skeleton />;
  if (detail.isError || !detail.data) return <Empty title="No such capability." detail="It is not in this project's spec index." />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <BackLink label="capabilities" onClick={onBack} />
        <span className="ac-mono text-ui text-text-strong">{capability}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_15rem]">
        <div className="flex flex-col gap-2">
          {detail.data.requirements.map((r, i) => (
            <article key={r.name || i} className={cx('v2-card p-3.5', r.delta?.kind === 'ADDED' && 'border-done/30', r.delta?.kind === 'REMOVED' && 'border-failed/30')}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="ac-mono text-micro text-text-3">{r.name}</span>
                {r.delta ? <Badge tone={DELTA_TONE[r.delta.kind]}>{r.delta.kind}</Badge> : null}
                <span className="flex-1" />
                <span className="ac-mono text-nano text-text-3">{r.scenarios.length} scenarios</span>
              </div>
              <p className={cx('text-meta leading-relaxed', r.delta?.kind === 'REMOVED' ? 'text-text-3 line-through' : 'text-text-2')}>{r.text}</p>
              {r.scenarios.length ? (
                <details className="mt-2">
                  <summary className="ac-mono cursor-pointer text-nano text-text-3">scenarios</summary>
                  <div className="mt-2 flex flex-col gap-1">
                    {r.scenarios.map((s, si) => (
                      <div key={si} className="ac-mono text-micro text-text-2">
                        {s.steps?.length ? s.steps.map((st) => `${st.word} ${st.text}`).join(' · ') : s.text}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </article>
          ))}
        </div>
        <aside className="flex flex-col gap-2">
          <SectionLabel>Change history</SectionLabel>
          {detail.data.history.map((h) => (
            <button key={h.changeName} type="button" onClick={() => onOpenChange(h.changeName)} className="v2-card px-3 py-2 text-left hover:bg-bg-2">
              <div className="ac-mono text-micro text-text-1">{h.changeName}</div>
              <div className="ac-mono mt-1 flex items-center gap-2 text-nano text-text-3">
                {h.ticketIdentifier ? <span>{h.ticketIdentifier}</span> : null}
                <span className={h.state === 'archived' ? 'text-done' : 'text-working'}>{h.state}</span>
                {h.archivedAt ? <span>{ago(h.archivedAt)}</span> : null}
              </div>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}

function ChangePage({ project, name, onBack }: { project: string; name: string; onBack: () => void }): React.ReactElement {
  const detail = useSpecChange(project, name);
  if (detail.isLoading) return <Skeleton />;
  if (detail.isError || !detail.data) return <Empty title="No such change." detail="It is not in this project's spec index." />;
  const c = detail.data;
  const tasks = c.tasks ?? [];
  const done = tasks.filter((t) => t.done).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <BackLink label="specs" onClick={onBack} />
        <span className="ac-mono text-ui text-text-strong">{c.changeName}</span>
        <Badge tone={c.state === 'active' ? 'modified' : 'neutral'}>{c.state}</Badge>
      </div>
      <div className="v2-card p-3.5">
        <div className="ac-label mb-2">
          Tasks · {done}/{tasks.length}
        </div>
        <div className="mb-3 h-1 overflow-hidden rounded-r4 bg-bg-3">
          <div className="h-full bg-done" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
        </div>
        <ul className="flex flex-col gap-1.5">
          {tasks.map((t, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className={cx('mt-0.5 size-3 flex-none rounded-r4 border', t.done ? 'border-done bg-done/20' : 'border-line-3')} aria-hidden />
              <span className={cx('text-meta', t.done ? 'text-text-3' : 'text-text-1')}>{t.text}</span>
            </li>
          ))}
        </ul>
      </div>
      {c.proposal ? (
        <section className="v2-card p-3.5">
          <SectionLabel>Proposal</SectionLabel>
          <Markdown source={c.proposal} />
        </section>
      ) : null}
      {c.design ? (
        <section className="v2-card p-3.5">
          <SectionLabel>Design</SectionLabel>
          <Markdown source={c.design} />
        </section>
      ) : null}
      {c.deltas.map((d) => (
        <section key={`${d.capability}-${d.kind}`} className="v2-card p-3.5">
          <div className="ac-label mb-2">
            {d.kind} · {d.capability}
          </div>
          <Markdown source={d.body} />
        </section>
      ))}
    </div>
  );
}

function Skeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-r4 bg-bg-2" />
      ))}
    </div>
  );
}

function Empty({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return (
    <div className="v2-card p-4">
      <p className="text-ui font-medium text-text-2">{title}</p>
      <p className="mt-1 text-meta text-text-3">{detail}</p>
    </div>
  );
}
