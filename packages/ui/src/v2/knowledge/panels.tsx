/**
 * Linked knowledge documents (PLAN §13): the catalogue grouped by project, and a viewer where
 * [[wiki-links]] open the linked document and backlinks show who depends on it.
 */
import { useMemo, useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { Button } from '../../components/Button';
import { Badge } from '../../components/StatusGlyph';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/States';
import {
  useKnowledgeDoc, useKnowledgeDocDetail, useKnowledgeDocMutation, useKnowledgeDocs, useKnowledgeMoveDoc, useKnowledgeMutation, useKnowledgeRevisions, useProjects,
} from '../../api/hooks';
import type { KnowledgeDocSummary } from '../../api/types';
import { ago } from '../../lib/format';
import { cx } from '../../lib/cx';
import { projectLabelFor } from '../../lib/projectName';
import { A } from '../../app/link';
import { useHostRoutes } from '../../app/host';
import { useWs } from '../../api/context';

export interface DocRef { scope: string; slug: string; project?: string }

/** `projects/<slug>/docs/[<folder>/...]<doc>.md` → { scope, slug, project }. Any folder depth (VS-265). */
export function refFromPath(path: string, projects: Array<{ id: string; slug: string }>): DocRef | null {
  let m = /^projects\/([^/]+)\/docs\/(?:[^/]+\/)*([^/]+)\.md$/.exec(path);
  if (m) {
    const project = projects.find((p) => p.slug === m![1])?.id;
    return { scope: 'project', slug: m[2]!, ...(project ? { project } : {}) };
  }
  m = /^workspace\/shared\/(?:[^/]+\/)*([^/]+)\.md$/.exec(path);
  if (m) return { scope: 'shared', slug: m[1]! };
  m = /^workspace\/docs\/(?:[^/]+\/)*([^/]+)\.md$/.exec(path);
  if (m) return { scope: 'workspace', slug: m[1]! };
  return null;
}

export function DocsPanel({ project, open, onOpen }: { project?: string; open: DocRef | null; onOpen: (ref: DocRef | null) => void }): React.ReactElement {
  const docs = useKnowledgeDocs(project);
  const projects = useProjects();
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => {
    const list = (docs.data ?? []).filter((d) => !filter || `${d.slug} ${d.title} ${d.summary}`.toLowerCase().includes(filter.toLowerCase()));
    const by = new Map<string, KnowledgeDocSummary[]>();
    for (const d of list) {
      const key = d.scope === 'project' ? (d.projectSlug ?? 'project') : d.scope;
      by.set(key, [...(by.get(key) ?? []), d]);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [docs.data, filter]);

  if (docs.isLoading) return <SkeletonRows rows={4} />;
  if (docs.isError) return <ErrorState code="KNOWLEDGE_DOCS_FAILED" message="The document catalogue could not be read." onRetry={() => void docs.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="ac-label">Documents</span>
        <span className="text-micro text-text-3">{docs.data?.length ?? 0} linked pages</span>
        <div className="flex-1" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          aria-label="Filter documents"
          className="ac-mono h-7 w-40 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1 outline-none"
        />
      </div>

      {!docs.data?.length ? (
        <EmptyState
          title="No documents yet."
          detail="Workers write one per subsystem, integration or runbook with weave_knowledge_doc_put and link them with [[slug]]. The scout ticket on a new project is usually the first."
        />
      ) : (
        groups.map(([group, list]) => (
          <section key={group}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-nano uppercase tracking-wide text-text-4">{projectLabelFor(projects.data, { slug: group }) ?? group}</span>
              <span className="text-nano text-text-4">{list.length}</span>
            </div>
            <div className="ac-card divide-y divide-line-1">
              {list.map((d) => {
                const active = open && open.slug === d.slug && open.scope === d.scope;
                return (
                  <button
                    key={d.path}
                    type="button"
                    onClick={() => onOpen({ scope: d.scope, slug: d.slug, ...(d.projectId ? { project: d.projectId } : {}) })}
                    className={cx('flex w-full items-start gap-3 px-3.5 py-2.5 text-left hover:bg-bg-2', active && 'bg-accent-tint')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-meta font-medium text-text-1">{d.title}</span>
                        <span className="ac-mono text-nano text-text-4">{d.slug}</span>
                        {d.backlinks === 0 ? <Badge tone="modified">orphan</Badge> : null}
                      </div>
                      {d.summary ? <div className="mt-0.5 truncate text-micro text-text-3">{d.summary}</div> : null}
                    </div>
                    <span className="ac-mono flex-none text-nano text-text-4">
                      {d.links}→ ←{d.backlinks} · {ago(d.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}

      {open ? <DocPanel doc={open} projects={projects.data ?? []} onOpen={onOpen} onClose={() => onOpen(null)} /> : null}
    </div>
  );
}

export function DocPanel({ doc, projects, onOpen, onClose }: { doc: DocRef; projects: Array<{ id: string; slug: string }>; onOpen: (ref: DocRef) => void; onClose?: () => void }): React.ReactElement {
  const detail = useKnowledgeDocDetail(doc.scope, doc.slug, doc.project);
  const mutate = useKnowledgeDocMutation();
  const move = useKnowledgeMoveDoc();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [body, setBody] = useState('');
  const [folder, setFolder] = useState('');

  // A [[slug]] resolves inside the same scope first, then to a shared document — same rule as the daemon.
  const follow = (slug: string): void => {
    const hit = detail.data?.linksTo.find((l) => l.slug === slug);
    if (hit?.path) { const ref = refFromPath(hit.path, projects); if (ref) { onOpen(ref); return; } }
    onOpen({ scope: doc.scope, slug, ...(doc.project ? { project: doc.project } : {}) });
  };
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a[href^="#doc:"]');
    if (!a) return;
    e.preventDefault();
    follow(a.getAttribute('href')!.slice('#doc:'.length));
  };

  return (
    <section className="ac-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-line-1 px-3.5 py-2.5">
        <span className="ac-mono text-micro text-text-2">{detail.data?.path ?? `${doc.scope}/${doc.slug}`}</span>
        {detail.data ? (
          <span className="ac-mono text-nano text-text-4">
            r{detail.data.revision} · {detail.data.tokenEstimate}/{detail.data.budgetTokens} tok
          </span>
        ) : null}
        <div className="flex-1" />
        {editing ? (
          <>
            <Button size="sm" variant="primary" onClick={() => { mutate.mutate({ scope: doc.scope, slug: doc.slug, project: doc.project, op: 'put', body }); setEditing(false); }}>
              Save
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </>
        ) : moving ? (
          <>
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="folder (empty = root)"
              aria-label="Move to folder"
              className="ac-mono h-7 w-48 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1 outline-none"
            />
            <Button size="sm" variant="primary" onClick={() => { move.mutate({ scope: doc.scope, slug: doc.slug, project: doc.project, folder: folder || undefined }); setMoving(false); }}>
              Move
            </Button>
            <Button size="sm" onClick={() => setMoving(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => { setFolder(detail.data?.folder ?? ''); setMoving(true); }}>Move</Button>
            <Button size="sm" onClick={() => { setBody(detail.data?.body ?? ''); setEditing(true); }}>Edit</Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (window.confirm(`Delete ${doc.slug}? The body is archived first; links to it become unresolved.`)) {
                  mutate.mutate({ scope: doc.scope, slug: doc.slug, project: doc.project, op: 'delete' });
                  onClose?.();
                }
              }}
            >
              Delete
            </Button>
            {onClose ? <Button size="sm" variant="ghost" onClick={onClose}>Close</Button> : null}
          </>
        )}
      </header>
      {detail.data?.folder ? <div className="ac-mono border-b border-line-1 px-3.5 py-1.5 text-nano text-text-4">{detail.data.folder}/</div> : null}

      <div className="grid gap-0 lg:grid-cols-[1fr_15rem]">
        <div className="p-3.5" onClick={onClick}>
          {detail.isLoading ? (
            <SkeletonRows rows={5} />
          ) : detail.isError ? (
            <EmptyState title="This document does not exist yet." detail="A [[link]] pointed here. Write it with weave_knowledge_doc_put, or fix the link." />
          ) : editing ? (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Document body"
              className="ac-mono h-96 w-full resize-y rounded-r6 border border-line-2 bg-bg-input p-3 text-micro leading-relaxed text-text-1 outline-none"
            />
          ) : (
            <Markdown source={detail.data?.body ?? ''} />
          )}
        </div>
        {detail.data ? (
          <aside className="flex flex-col gap-4 border-t border-line-1 p-3.5 lg:border-l lg:border-t-0">
            <div>
              <div className="ac-label mb-1.5">Links to</div>
              {detail.data.linksTo.length ? (
                <ul className="flex flex-col gap-1">
                  {detail.data.linksTo.map((l) => (
                    <li key={l.slug}>
                      <button type="button" onClick={() => follow(l.slug)} className={cx('ac-mono text-micro', l.path ? 'text-accent-link hover:underline' : 'text-text-4 line-through')} title={l.path ?? 'unresolved'}>
                        {l.title ?? l.slug}
                      </button>
                      {!l.path ? <span className="ml-1 text-nano text-working">unresolved</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-micro text-text-4">none</span>
              )}
            </div>
            <div>
              <div className="ac-label mb-1.5">Linked from</div>
              {detail.data.linkedFrom.length ? (
                <ul className="flex flex-col gap-1">
                  {detail.data.linkedFrom.map((l) => {
                    const ref = refFromPath(l.path, projects);
                    return (
                      <li key={l.path}>
                        {ref ? (
                          <button type="button" onClick={() => onOpen(ref)} className="ac-mono text-micro text-accent-link hover:underline">{l.title ?? l.slug ?? l.path}</button>
                        ) : (
                          <span className="ac-mono text-micro text-text-2">{l.title ?? l.path}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <span className="text-micro text-working">orphan — nothing links here yet</span>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

/** A hub file's viewer (PROJECT.md/WORKSPACE.md/SHARED.md/decisions.md) — governed differently from a linked document: curated in place, no folder, no move. */
export function KnowledgeDocPanel({ scope, project, onClose, onOpenDoc }: { scope: string; project?: string; onClose?: () => void; onOpenDoc?: (ref: DocRef) => void }): React.ReactElement {
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
  const host = useHostRoutes();
  const ws = useWs();
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
            {onClose ? (
              <Button size="sm" variant="ghost" onClick={onClose}>
                Close
              </Button>
            ) : null}
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
                {r.ticketIdentifier ? (
                  <A to={host.ticket} params={{ ws, ticketId: r.ticketIdentifier }} className="ac-mono text-nano text-accent-link">
                    {r.ticketIdentifier}
                  </A>
                ) : null}
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
