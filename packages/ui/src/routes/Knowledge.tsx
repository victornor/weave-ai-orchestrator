import { lazy, Suspense, useMemo, useState } from 'react';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Segmented, Tabs } from '../components/Tabs';
import { BudgetMeter } from '../components/BudgetMeter';
import { Markdown } from '../components/Markdown';
import { Button } from '../components/Button';
import { Badge, StatusGlyph } from '../components/StatusGlyph';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import {
  useCapabilities,
  useCapability,
  useKnowledgeDoc,
  useKnowledgeIndex,
  useKnowledgeMutation,
  useKnowledgeRevisions,
  useProjects,
  useSearch,
  useSpecChange,
  useSpecChanges,
  useSpecGraph,
} from '../api/hooks';
import { ago } from '../lib/format';
import { cx } from '../lib/cx';
import { DocsPanel, DocPanel, refFromPath, type DocRef } from './KnowledgeDocs';
import { ChangelogPanel } from './Changelog';

// The graph is the only screen that needs a force-layout engine. Loading it on demand keeps
// `d3-force` and the renderer out of the chunk every other page pays for.
const KnowledgeGraphView = lazy(async () => ({ default: (await import('./KnowledgeGraph')).KnowledgeGraphView }));

type Tab = 'knowledge' | 'changelog' | 'graph' | 'specs';

export function KnowledgeRoute(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('knowledge');
  const [q, setQ] = useState('');
  const projects = useProjects();
  const [project, setProject] = useState<string>('');
  const search = useSearch(q, project || undefined);
  const activeProject = project || projects.data?.[0]?.id || '';

  return (
    <Page>
      <PageHeader
        title="Knowledge & Specs"
        actions={
          <label className="flex items-center gap-2">
            <span className="ac-label">project</span>
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              aria-label="Project"
              className="ac-mono h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1"
            >
              <option value="">all</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.slug}
                </option>
              ))}
            </select>
          </label>
        }
        tabs={
          <div className="flex flex-col gap-2 px-4 pb-3 md:px-5">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search knowledge and specs…"
              aria-label="Search knowledge and specs"
              className="h-9 w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none placeholder:text-text-4"
            />
            <Tabs
              items={[
                { key: 'knowledge', label: 'Knowledge' },
                { key: 'changelog', label: 'Changelog' },
                { key: 'graph', label: 'Graph' },
                { key: 'specs', label: 'Specs' },
              ]}
              active={tab}
              onChange={(k) => setTab(k as Tab)}
              className="border-b-0"
            />
          </div>
        }
      />
      <PageBody className="p-4 md:p-5">
        {q.trim().length > 1 ? (
          <SearchResults hits={search.data ?? []} loading={search.isLoading} />
        ) : tab === 'knowledge' ? (
          <KnowledgePanel project={project || undefined} />
        ) : tab === 'changelog' ? (
          // No project selected is the workspace changelog: every project's entries plus the ones
          // belonging to none. That is the scope the panel gets when `project` is undefined.
          <ChangelogPanel project={project || undefined} />
        ) : tab === 'graph' ? (
          <GraphPanel project={project || undefined} />
        ) : (
          <SpecsPanel project={activeProject} />
        )}
      </PageBody>
    </Page>
  );
}

function SearchResults({ hits, loading }: { hits: ReturnType<typeof useSearch>['data'] extends undefined ? never[] : NonNullable<ReturnType<typeof useSearch>['data']>; loading: boolean }): React.ReactElement {
  if (loading) return <SkeletonRows rows={5} />;
  if (!hits.length) return <EmptyState title="Nothing matches." detail="Try a requirement phrase, a capability name, or a ticket id." />;
  return (
    <div className="mx-auto max-w-3xl divide-y divide-line-1 rounded-r6 border border-line-1">
      {hits.map((h, i) => (
        <div key={i} className="flex items-start gap-3 px-3.5 py-2.5">
          <Badge tone={h.kind === 'change' ? 'modified' : h.kind === 'requirement' ? 'added' : 'neutral'}>{h.kind}</Badge>
          <div className="min-w-0 flex-1">
            <div className="text-meta text-text-1">{h.title}</div>
            {h.subtitle ? <div className="ac-mono mt-0.5 text-micro text-text-3">{h.subtitle}</div> : null}
          </div>
          {h.projectSlug ? <span className="ac-mono text-nano text-text-4">{h.projectSlug}</span> : null}
        </div>
      ))}
    </div>
  );
}

function KnowledgePanel({ project }: { project?: string }): React.ReactElement {
  const index = useKnowledgeIndex();
  const mutate = useKnowledgeMutation();
  const [open, setOpen] = useState<{ scope: string; project?: string } | null>(null);
  const [openDoc, setOpenDoc] = useState<DocRef | null>(null);

  if (index.isLoading) return <SkeletonRows rows={4} />;
  if (index.isError) return <ErrorState code="KNOWLEDGE_LINT_FAILED" message="The knowledge index could not be read." onRetry={() => void index.refetch()} />;

  const files = (index.data?.files ?? []).filter((f) => f.kind !== 'doc' && (!project || !f.projectId || f.projectId === project));
  if (!files.length) return <EmptyState title="No knowledge files yet." detail="They are created with the workspace and each project." />;
  const hubLabel = (f: (typeof files)[number]): string =>
    f.scope === 'project' ? `${f.projectSlug ?? 'project'} · PROJECT.md` : f.scope === 'shared' ? 'workspace · SHARED.md' : f.scope === 'decisions' ? 'workspace · decisions.md' : 'workspace · WORKSPACE.md';

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {files.map((f) => (
          <button key={f.id ?? f.path} type="button" onClick={() => { setOpenDoc(null); setOpen({ scope: f.scope, ...(f.projectId ? { project: f.projectId } : {}) }); }} className="text-left">
            <BudgetMeter
              label={hubLabel(f)}
              used={f.tokenEstimate}
              budget={f.budgetTokens}
              lastCuratedAt={f.lastCuratedAt}
              curationPending={f.curationPending}
              nextInDays={f.curationDueInDays ?? null}
              onCurate={() => mutate.mutate({ scope: f.scope, ...(f.projectId ? { project: f.projectId } : {}), op: 'curate' })}
            />
          </button>
        ))}
      </div>
      {index.data?.warnings.length ? (
        <div className="ac-card border-working/30 p-3.5">
          <div className="ac-label mb-1.5">Lint</div>
          <ul className="flex flex-col gap-1">
            {index.data.warnings.map((w, i) => (
              <li key={i} className="text-micro text-text-2">
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {open ? <KnowledgeDocPanel scope={open.scope} project={open.project} onClose={() => setOpen(null)} onOpenDoc={(ref) => { setOpen(null); setOpenDoc(ref); }} /> : null}
      <DocsPanel project={project} open={openDoc} onOpen={(ref) => { setOpen(null); setOpenDoc(ref); }} />
    </div>
  );
}

function GraphPanel({ project }: { project?: string }): React.ReactElement {
  const projects = useProjects();
  const [openDoc, setOpenDoc] = useState<DocRef | null>(null);
  const [openHub, setOpenHub] = useState<{ scope: string; project?: string } | null>(null);
  const openPath = (path: string): void => {
    const ref = refFromPath(path, projects.data ?? []);
    if (ref) { setOpenHub(null); setOpenDoc(ref); return; }
    const m = /^projects\/([^/]+)\/PROJECT\.md$/.exec(path);
    const scope = m ? 'project' : path.endsWith('SHARED.md') ? 'shared' : path.endsWith('decisions.md') ? 'decisions' : 'workspace';
    const pid = m ? projects.data?.find((p) => p.slug === m[1])?.id : undefined;
    setOpenDoc(null);
    setOpenHub({ scope, ...(pid ? { project: pid } : {}) });
  };
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Suspense fallback={<SkeletonRows rows={6} />}>
        <KnowledgeGraphView project={project} onOpen={openPath} />
      </Suspense>
      {openDoc ? <DocPanel doc={openDoc} projects={projects.data ?? []} onOpen={(ref) => { setOpenHub(null); setOpenDoc(ref); }} onClose={() => setOpenDoc(null)} /> : null}
      {openHub ? <KnowledgeDocPanel scope={openHub.scope} project={openHub.project} onClose={() => setOpenHub(null)} onOpenDoc={(ref) => { setOpenHub(null); setOpenDoc(ref); }} /> : null}
    </div>
  );
}

function KnowledgeDocPanel({ scope, project, onClose, onOpenDoc }: { scope: string; project?: string; onClose: () => void; onOpenDoc?: (ref: DocRef) => void }): React.ReactElement {
  const doc = useKnowledgeDoc(scope, project);
  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a[href^="#doc:"]');
    if (!a || !onOpenDoc) return;
    e.preventDefault();
    const slug = a.getAttribute('href')!.slice('#doc:'.length);
    onOpenDoc({ scope: scope === 'project' ? 'project' : 'shared', slug, ...(project ? { project } : {}) });
  };
  const revisions = useKnowledgeRevisions(scope, project);
  const mutate = useKnowledgeMutation();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');

  return (
    <section className="ac-card">
      <header className="flex items-center gap-2 border-b border-line-1 px-3.5 py-2.5">
        <span className="ac-mono text-micro text-text-2">{doc.data?.path ?? scope}</span>
        <div className="flex-1" />
        {editing ? (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                mutate.mutate({ scope, ...(project ? { project } : {}), op: 'put', body });
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => {
                setBody(doc.data?.body ?? '');
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </header>
      <div className="p-3.5" onClick={onBodyClick}>
        {doc.isLoading ? (
          <SkeletonRows rows={4} />
        ) : editing ? (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Knowledge body"
            className="ac-mono h-96 w-full resize-y rounded-r6 border border-line-2 bg-bg-input p-3 text-micro leading-relaxed text-text-1 outline-none"
          />
        ) : (
          <Markdown source={doc.data?.body ?? ''} />
        )}
      </div>
      {revisions.data?.length ? (
        <div className="border-t border-line-1 p-3.5">
          <div className="ac-label mb-2">Revisions</div>
          <div className="flex flex-col gap-1.5">
            {revisions.data.slice(0, 8).map((r) => (
              <div key={r.revision} className="flex items-center gap-3">
                <span className="ac-mono text-micro text-text-3">r{r.revision}</span>
                <span className="flex-1 text-micro text-text-2">{r.reason}</span>
                <span className="ac-mono text-nano text-text-4">{ago(r.createdAt)}</span>
                <button type="button" className="text-micro text-accent-link" onClick={() => mutate.mutate({ scope, ...(project ? { project } : {}), op: 'revert', revision: r.revision })}>
                  Revert
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ specs */

function SpecsPanel({ project }: { project: string }): React.ReactElement {
  const [capability, setCapability] = useState<string | null>(null);
  const [change, setChange] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'graph'>('list');
  const capabilities = useCapabilities(project);
  const changes = useSpecChanges(project);

  if (!project) return <EmptyState title="No project selected." detail="Pick a project to browse its specs." />;
  if (change) return <ChangePage project={project} name={change} onBack={() => setChange(null)} />;
  if (capability) return <CapabilityPage project={project} capability={capability} onBack={() => setCapability(null)} onOpenChange={setChange} />;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Segmented
          ariaLabel="Spec view"
          options={[
            { value: 'list', label: 'List' },
            { value: 'graph', label: 'Graph' },
          ]}
          value={view}
          onChange={setView}
        />
        <span className="ac-mono text-nano text-text-4">specs are read-only — they change through tickets</span>
      </div>

      {view === 'graph' ? (
        <SpecGraphView project={project} onOpenCapability={setCapability} onOpenChange={setChange} />
      ) : capabilities.isLoading ? (
        <SkeletonRows rows={5} />
      ) : capabilities.isError ? (
        <ErrorState code="SPEC_INDEX_UNAVAILABLE" message="The spec index has not been built for this project." onRetry={() => void capabilities.refetch()} />
      ) : (capabilities.data?.length ?? 0) === 0 ? (
        <EmptyState title="No capabilities yet." detail="They appear once a change is archived into the main specs." />
      ) : (
        <>
          <div className="ac-card divide-y divide-line-1">
            {(capabilities.data ?? []).map((c) => (
              <button key={c.capability} type="button" onClick={() => setCapability(c.capability)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-bg-2">
                <StatusGlyph status={c.pendingChanges.length ? 'working' : 'idle'} size="xs" />
                <span className="ac-mono flex-1 text-meta text-text-1">{c.capability}</span>
                <span className="text-micro text-text-3">{c.requirementCount} requirements</span>
                {c.pendingChanges.length ? (
                  <span className="ac-mono text-nano text-working">{c.pendingChanges.map((p) => p.ticketIdentifier ?? p.changeName).join(' · ')}</span>
                ) : null}
                <span className="ac-mono text-nano text-text-4">{ago(c.updatedAt)}</span>
              </button>
            ))}
          </div>

          <section>
            <div className="ac-label mb-2">Changes</div>
            <div className="ac-card divide-y divide-line-1">
              {(changes.data ?? []).map((c) => (
                <button key={c.changeName} type="button" onClick={() => setChange(c.changeName)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-bg-2">
                  <Badge tone={c.state === 'active' ? 'modified' : 'neutral'}>{c.state}</Badge>
                  <span className="ac-mono flex-1 text-meta text-text-1">{c.changeName}</span>
                  {c.taskProgress ? (
                    <span className="ac-mono text-micro text-text-3">
                      {c.taskProgress.done}/{c.taskProgress.total} tasks
                    </span>
                  ) : null}
                  {c.ticketIdentifier ? <span className="ac-mono text-micro text-text-3">{c.ticketIdentifier}</span> : null}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const DELTA_TONE = { ADDED: 'added', MODIFIED: 'modified', REMOVED: 'removed', RENAMED: 'modified' } as const;

function CapabilityPage({
  project,
  capability,
  onBack,
  onOpenChange,
}: {
  project: string;
  capability: string;
  onBack: () => void;
  onOpenChange: (name: string) => void;
}): React.ReactElement {
  const detail = useCapability(project, capability);
  if (detail.isLoading) return <SkeletonRows rows={6} />;
  if (detail.isError || !detail.data) return <ErrorState code="CAPABILITY_NOT_FOUND" message="No such capability in this project." />;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="link" onClick={onBack}>
          ← capabilities
        </Button>
        <span className="ac-mono text-head text-text-strong">{capability}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="flex flex-col gap-2">
          {detail.data.requirements.map((r, i) => (
            <article
              key={r.name || i}
              className={cx(
                'rounded-r6 border p-3.5',
                r.delta ? (r.delta.kind === 'ADDED' ? 'border-done/30 bg-done/5' : r.delta.kind === 'REMOVED' ? 'border-failed/30 bg-failed/5' : 'border-working/35 bg-working/5') : 'border-line-1 bg-bg-1',
              )}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="ac-mono text-micro text-text-3">{r.name}</span>
                {r.delta ? (
                  <>
                    <Badge tone={DELTA_TONE[r.delta.kind]}>{r.delta.kind}</Badge>
                    <span className="ac-mono text-nano text-text-3">
                      {r.delta.ticketIdentifier ?? r.delta.changeName} · {r.delta.state}
                    </span>
                  </>
                ) : null}
                <div className="flex-1" />
                <span className="ac-mono text-nano text-text-4">{r.scenarios.length} scenarios</span>
              </div>
              <p className={cx('text-meta leading-relaxed', r.delta?.kind === 'REMOVED' ? 'text-text-3 line-through' : 'text-text-body')}>{r.text}</p>
              {r.scenarios.length ? (
                <details className="mt-2">
                  <summary className="ac-mono cursor-pointer text-nano text-text-4">scenarios</summary>
                  <div className="mt-2 flex flex-col gap-1">
                    {r.scenarios.map((s, i) => (
                      <div key={i} className="ac-mono text-micro text-text-2">
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
          <div className="ac-label">Change history</div>
          {detail.data.history.map((h) => (
            <button key={h.changeName} type="button" onClick={() => onOpenChange(h.changeName)} className="ac-card px-3 py-2 text-left hover:bg-bg-2">
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
  if (detail.isLoading) return <SkeletonRows rows={6} />;
  if (detail.isError || !detail.data) return <ErrorState code="CHANGE_NOT_FOUND" message="No such change." />;
  const c = detail.data;
  const tasks = c.tasks ?? [];
  const deltas = c.deltas ?? [];
  const done = tasks.filter((t) => t.done).length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="link" onClick={onBack}>
          ← specs
        </Button>
        <span className="ac-mono text-head text-text-strong">{c.changeName}</span>
        <Badge tone={c.state === 'active' ? 'modified' : 'neutral'}>{c.state}</Badge>
      </div>

      <div className="ac-card p-3.5">
        <div className="ac-label mb-2">
          Tasks · {done}/{tasks.length}
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-pill bg-bg-3">
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
        <section className="ac-card p-3.5">
          <div className="ac-label mb-2">Proposal</div>
          <Markdown source={c.proposal} />
        </section>
      ) : null}
      {c.design ? (
        <section className="ac-card p-3.5">
          <div className="ac-label mb-2">Design</div>
          <Markdown source={c.design} />
        </section>
      ) : null}
      {deltas.map((d) => (
        <section key={`${d.capability}-${d.kind}`} className="ac-card p-3.5">
          <div className="ac-label mb-2">
            {d.kind} · {d.capability}
          </div>
          <Markdown source={d.body} />
        </section>
      ))}
    </div>
  );
}

/**
 * Graph on desktop; on a phone the same data is the selected node then its
 * neighbours as a list, one hop at a time (designer's call 4).
 */
function SpecGraphView({
  project,
  onOpenCapability,
  onOpenChange,
}: {
  project: string;
  onOpenCapability: (c: string) => void;
  onOpenChange: (c: string) => void;
}): React.ReactElement {
  const graph = useSpecGraph(project);
  const [selected, setSelected] = useState<string | null>(null);

  const layout = useMemo(() => {
    const nodes = graph.data?.nodes ?? [];
    const cols = { capability: 0, change: 1, ticket: 2 } as const;
    const counters = { capability: 0, change: 0, ticket: 0 };
    return nodes.map((n) => {
      const col = cols[n.kind];
      const row = counters[n.kind]++;
      return { ...n, x: 12 + col * 38, y: 8 + row * 11 };
    });
  }, [graph.data]);

  const byId = useMemo(() => new Map(layout.map((n) => [n.id, n])), [layout]);
  const neighbours = useMemo(() => {
    if (!selected) return [];
    return (graph.data?.edges ?? [])
      .filter((e) => e.from === selected || e.to === selected)
      .map((e) => ({ id: e.from === selected ? e.to : e.from, kind: e.kind }))
      .map((n) => ({ ...n, node: byId.get(n.id) }))
      .filter((n) => n.node);
  }, [selected, graph.data, byId]);

  if (graph.isLoading) return <SkeletonRows rows={5} />;
  if (graph.isError) return <ErrorState code="SPEC_GRAPH_UNAVAILABLE" message="The graph could not be built." onRetry={() => void graph.refetch()} />;

  const open = (id: string): void => {
    const n = byId.get(id);
    if (!n) return;
    if (n.kind === 'capability') onOpenCapability(n.label);
    else if (n.kind === 'change') onOpenChange(n.label);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* desktop: simple column layout in SVG */}
      <div className="ac-card hidden p-3 md:block">
        <svg viewBox="0 0 100 100" className="h-[28rem] w-full" role="img" aria-label="Capability, change and ticket graph">
          {(graph.data?.edges ?? []).map((e, i) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            return <line key={i} x1={a.x + 10} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line-2)" strokeWidth="0.3" />;
          })}
          {layout.map((n) => (
            <g key={n.id} onClick={() => setSelected(n.id)} onDoubleClick={() => open(n.id)} className="cursor-pointer">
              <rect
                x={n.x}
                y={n.y - 3}
                width="26"
                height="6"
                rx={n.kind === 'change' ? 3 : 1}
                fill={n.kind === 'capability' ? 'var(--status-working)' : n.kind === 'change' ? 'var(--status-done)' : 'var(--bg-2)'}
                fillOpacity={n.kind === 'ticket' ? 1 : 0.14}
                stroke={selected === n.id ? 'var(--accent)' : n.kind === 'capability' ? 'var(--status-working)' : n.kind === 'change' ? 'var(--status-done)' : 'var(--line-2)'}
                strokeWidth="0.3"
              />
              <text x={n.x + 1.5} y={n.y + 1} fontSize="2.4" fill="var(--text-2)" className="ac-mono">
                {n.label.slice(0, 18)}
              </text>
            </g>
          ))}
        </svg>
        <p className="ac-mono mt-2 text-nano text-text-4">click to select · double-click to open</p>
      </div>

      {/* phone: selected node then neighbours, one hop at a time */}
      <div className="ac-card md:hidden">
        <div className="border-b border-line-1 px-3.5 py-2.5">
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value || null)}
            aria-label="Selected node"
            className="ac-mono w-full bg-transparent text-meta text-text-1 outline-none"
          >
            <option value="">pick a node…</option>
            {layout.map((n) => (
              <option key={n.id} value={n.id}>
                {n.kind} · {n.label}
              </option>
            ))}
          </select>
        </div>
        {selected ? (
          <div className="divide-y divide-line-1">
            {neighbours.map((n) => (
              <button key={n.id} type="button" onClick={() => setSelected(n.id)} onDoubleClick={() => open(n.id)} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left">
                <StatusGlyph status={n.node!.kind === 'capability' ? 'working' : n.node!.kind === 'change' ? 'done' : 'idle'} size="xs" />
                <span className="ac-mono flex-1 text-meta text-text-1">{n.node!.label}</span>
                <span className="text-micro text-text-3">{n.kind}</span>
              </button>
            ))}
            {!neighbours.length ? <p className="px-3.5 py-4 text-meta text-text-3">No neighbours.</p> : null}
          </div>
        ) : (
          <p className="px-3.5 py-4 text-meta text-text-3">Pick a node to walk its neighbours.</p>
        )}
      </div>
    </div>
  );
}
