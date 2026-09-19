/**
 * The V2 Specs tab (VS-371): the project's OpenSpec capabilities and the active and archived changes
 * that shaped them, moved here out of the Knowledge home so the home no longer mixes specs into the
 * knowledge base view.
 *
 * The section and the capability/change pages are the ones VS-347 built, unchanged except for the
 * project picker moving to the shared frame (`KnowledgeFrame.tsx`).
 */
import { useState } from 'react';
import { useCapabilities, useCapability, useProjects, useSpecChange, useSpecChanges } from '../../api/hooks';
import { Badge } from '../../components/StatusGlyph';
import { Markdown } from '../../components/Markdown';
import type { CapabilitySummary, SpecChangeSummary } from '../../api/types';
import { ago } from '../../lib/format';
import { cx } from '../../lib/cx';
import { projectLabelFor } from '../../lib/projectName';
import { useProjectScope } from './KnowledgeFrame';
import { BackLink, Empty, Skeleton } from './KnowledgeParts';

export function KnowledgeSpecsPage(): React.ReactElement {
  const project = useProjectScope();
  const projects = useProjects();
  const projectList = projects.data ?? [];
  // Specs are per-project; with no project chosen, fall back to the first, as V1's specs tab does.
  const activeProject = project || projectList[0]?.id || '';
  const [capability, setCapability] = useState<string | null>(null);
  const [change, setChange] = useState<string | null>(null);
  // VS-578: an OpenSpec-off project has no capability or change index; say so rather than showing an
  // empty "No capabilities yet", which reads as a project that simply has none.
  const openspecOff = projectList.find((p) => p.id === activeProject)?.openspecEnabled === false;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 md:p-5">
      {openspecOff ? (
        <Empty
          title="OpenSpec is off for this project."
          detail="Its change tickets use a short plan instead of proposals and specs. Turn the mode on in project settings to browse specs."
        />
      ) : change && activeProject ? (
        <ChangePage project={activeProject} name={change} onBack={() => setChange(null)} />
      ) : capability && activeProject ? (
        <CapabilityPage project={activeProject} capability={capability} onBack={() => setCapability(null)} onOpenChange={setChange} />
      ) : (
        <>
          <p className="text-meta text-text-3">
            Specs are this project's OpenSpec capabilities — what it does — and the changes that shaped them.
          </p>
          <SpecsSection
            project={activeProject}
            projectLabel={activeProject ? projectLabelFor(projectList, { id: activeProject }) : null}
            onOpenCapability={setCapability}
            onOpenChange={setChange}
          />
        </>
      )}
    </div>
  );
}

function SpecsSection({
  project,
  projectLabel,
  onOpenCapability,
  onOpenChange,
}: {
  project: string;
  projectLabel: string | null;
  onOpenCapability: (c: string) => void;
  onOpenChange: (c: string) => void;
}): React.ReactElement {
  const capabilities = useCapabilities(project);
  const changes = useSpecChanges(project);

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className="ac-label">Capabilities{projectLabel ? ` · ${projectLabel}` : ''}</span>
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
          <div className="ac-label mb-2">Changes</div>
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
          <div className="ac-label">Change history</div>
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
          <div className="ac-label mb-2">Proposal</div>
          <Markdown source={c.proposal} />
        </section>
      ) : null}
      {c.design ? (
        <section className="v2-card p-3.5">
          <div className="ac-label mb-2">Design</div>
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
