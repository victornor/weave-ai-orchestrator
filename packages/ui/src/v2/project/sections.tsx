/**
 * The V2 project overview's section contract and its simpler bodies (web-v2/project-overview).
 *
 * Every section is a V2 card with a heading and a disclosure, and supplies only its content, so a
 * body can be replaced without the page learning anything about it. History and Pull requests live in
 * their own modules; the rest are here. All of them read the same hooks and pure view models V1's
 * sections do, with V2 chrome and links under `/v2`.
 */
import { useState } from 'react';
import type { Project } from '@weave-ai/shared';
import { workerPauseReason } from '@weave-ai/render';
import { A } from '../../app/link';
import { useChangelogHeatmap, useChangelogRecent, useDecisions, useKnowledgeDoc, useKnowledgeDocs, useKnowledgeHealth, useRuns, useTickets, useWorkers } from '../../api/hooks';
import { ActivityHeatmap } from '../../components/Heatmap';
import { BudgetMeter } from '../../components/BudgetMeter';
import { StatusGlyph } from '../../components/StatusGlyph';
import { SkeletonRows } from '../../components/Skeleton';
import { projectLabel } from '@weave-ai/shared';
import { filterTickets, foldBoard, liveWorkersByTicket, pausedWorkersByTicket, ticketBoardStatus } from '../../lib/board';
import { lastLinesByAgent, recentLandings, knowledgeSections } from '../../lib/projectOverview';
import { ago, statusText } from '../../lib/format';
import { KIND_LABEL } from '../../routes/Changelog';
import { cx } from '../../lib/cx';
import { HistorySection } from './HistorySection';
import { PullRequestsSection } from './PullRequestsSection';
import { RoadmapSection } from './RoadmapSection';

export interface V2ProjectSectionProps {
  project: Project;
  ws: string;
}

export type V2ProjectSectionKey = 'needs' | 'work' | 'roadmap' | 'history' | 'pulls' | 'landings' | 'activity' | 'knowledge';

export interface V2ProjectSectionDef {
  key: V2ProjectSectionKey;
  label: string;
  column: 'main' | 'side';
  Body: (props: V2ProjectSectionProps) => React.ReactElement;
}

/** The shell: a V2 card, its heading and a disclosure. It owns no data. */
export function V2ProjectSection({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(true);
  const bodyId = `v2-project-section-${id}`;
  return (
    <section id={id} className={cx('v2-card flex min-w-0 flex-col scroll-mt-4', className)}>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className={cx('text-nano text-text-4 transition-transform', open && 'rotate-90')} aria-hidden>
            ▸
          </span>
          <h2 className="text-ui font-medium text-text-1">{label}</h2>
        </button>
      </div>
      {open ? (
        <div id={bodyId} className="v2-anim-fade border-t border-line-1 px-3.5 py-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** The project's open human decisions, found through the ticket each one is about. */
function NeedsYouSection({ project, ws }: V2ProjectSectionProps): React.ReactElement {
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const tickets = useTickets({ limit: 300 });
  const byId = new Map((tickets.data ?? []).map((t) => [t.id, t]));
  const mine = (decisions.data ?? []).filter((d) => d.ticketId !== null && byId.get(d.ticketId)?.projectId === project.id);

  if (decisions.isLoading || tickets.isLoading) return <SkeletonRows rows={2} />;
  if (!mine.length) return <p className="text-meta text-text-3">Nothing is waiting for you in this project.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {mine.map((d) => {
        const t = d.ticketId ? byId.get(d.ticketId) : undefined;
        return (
          <li key={d.id}>
            <A to="/v2/w/$ws/tickets/$ticketId" params={{ ws, ticketId: t?.identifier ?? d.ticketId ?? '' }} className="flex items-start gap-2.5 rounded-r4 px-1 py-1 hover:bg-bg-2">
              <StatusGlyph status="needs-you" size="xs" className="mt-1" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-meta text-text-1">{d.title}</span>
                <span className="ac-mono text-nano text-text-3">
                  {t?.identifier ?? '—'} · {d.kind.replace(/_/g, ' ')}
                </span>
              </span>
              <span className="ac-mono flex-none text-nano text-text-4">{ago(d.createdAt)}</span>
            </A>
          </li>
        );
      })}
    </ul>
  );
}

/** The project's unfinished tickets, folded by the board's own columns. */
function WorkSection({ project, ws }: V2ProjectSectionProps): React.ReactElement {
  const tickets = useTickets({ limit: 300 });
  const workers = useWorkers({});
  const runs = useRuns({ limit: 100 });
  const live = liveWorkersByTicket(workers.data ?? []);
  const paused = pausedWorkersByTicket(workers.data ?? []);
  const lines = lastLinesByAgent(runs.data ?? []);
  const columns = foldBoard(
    filterTickets(tickets.data ?? [], { project: project.id }).filter((t) => t.status !== 'done' && t.status !== 'cancelled'),
    live,
  ).filter((c) => c.items.length > 0);

  if (tickets.isLoading) return <SkeletonRows rows={3} />;
  if (!columns.length) return <p className="text-meta text-text-3">Nothing is under way in this project.</p>;

  return (
    <div className="flex flex-col gap-3.5">
      {columns.map((c) => (
        <div key={c.key}>
          <div className="ac-label mb-1.5 flex items-center gap-2">
            <StatusGlyph status={c.status} size="xs" />
            {c.label}
            <span className="ac-mono text-nano text-text-4">{c.items.length}</span>
          </div>
          <ul className="flex flex-col gap-1">
            {c.items.map((t) => {
              const worker = live.get(t.id);
              const line = worker ? lines.get(worker.id) : undefined;
              const pausedReason = worker ? null : (() => {
                const p = paused.get(t.id);
                return p ? workerPauseReason(p) : null;
              })();
              return (
                <li key={t.id}>
                  <A to="/v2/w/$ws/tickets/$ticketId" params={{ ws, ticketId: t.identifier }} className="flex flex-col gap-1 rounded-r4 px-1 py-1 hover:bg-bg-2">
                    <span className="flex items-center gap-2">
                      <StatusGlyph status={ticketBoardStatus(t.status, { live: Boolean(worker) })} size="xs" />
                      <span className="ac-mono flex-none text-nano text-text-3">{t.identifier}</span>
                      <span className="min-w-0 flex-1 truncate text-meta text-text-1">{t.title}</span>
                      <span className="ac-mono flex-none text-nano text-text-4">{ago(t.updatedAt)}</span>
                    </span>
                    <span className="ac-mono flex items-center gap-2 pl-5 text-nano text-text-3">
                      <span>{statusText(t.status)}</span>
                      {worker ? <span className="truncate">{worker.name}</span> : null}
                    </span>
                    {pausedReason ? (
                      <span className="ac-mono ac-truncate ml-5 rounded-r4 bg-bg-2 px-2 py-1 text-nano text-text-3">paused · {pausedReason}</span>
                    ) : line ? (
                      <span className="ac-mono ac-truncate ml-5 rounded-r4 bg-bg-2 px-2 py-1 text-nano text-text-2">{line}</span>
                    ) : null}
                  </A>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** What reached the repository in the last fortnight, read off the project's changelog. */
function LandingsSection({ project, ws }: V2ProjectSectionProps): React.ReactElement {
  const recent = useChangelogRecent(project.id);
  const landings = recentLandings(recent.data?.entries ?? []);
  if (recent.isLoading) return <SkeletonRows rows={3} />;
  if (!landings.length) return <p className="text-meta text-text-3">Nothing landed in the last 14 days.</p>;

  return (
    <ul className="flex flex-col gap-1">
      {landings.map((l) => (
        <li key={`${l.ticketId ?? l.identifier}-${l.at}`} className="flex items-center gap-2 px-1 py-1">
          <StatusGlyph status="done" size="xs" />
          {l.identifier ? (
            <A to="/v2/w/$ws/tickets/$ticketId" params={{ ws, ticketId: l.identifier }} className="ac-mono flex-none text-nano text-accent-link">
              {l.identifier}
            </A>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-meta text-text-1">{l.summary}</span>
          {l.prUrl ? (
            <a href={l.prUrl} target="_blank" rel="noreferrer" className="ac-mono flex-none text-nano text-accent-link" aria-label={`Pull request for ${l.identifier ?? 'this landing'}`}>
              PR
            </a>
          ) : null}
          <span className="ac-mono flex-none text-nano text-text-4">{ago(l.at)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The project's recent changelog: the heatmap and the newest entries, linking the full timeline. */
function ActivitySection({ project, ws }: V2ProjectSectionProps): React.ReactElement {
  const heat = useChangelogHeatmap(project.id);
  const recent = useChangelogRecent(project.id);
  const entries = (recent.data?.entries ?? []).slice(0, 12);

  return (
    <div className="flex flex-col gap-3.5">
      {heat.data ? (
        <div className="overflow-x-auto">
          <ActivityHeatmap heatmap={heat.data} />
        </div>
      ) : heat.isLoading ? (
        <SkeletonRows rows={1} />
      ) : null}

      {recent.isLoading ? (
        <SkeletonRows rows={4} />
      ) : entries.length === 0 ? (
        <p className="text-meta text-text-3">Nothing has happened in this project yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 px-1 py-1">
              <span className="v2-tag flex-none text-text-3">{KIND_LABEL[e.kind]}</span>
              {e.ticketIdentifier ? (
                <A to="/v2/w/$ws/tickets/$ticketId" params={{ ws, ticketId: e.ticketIdentifier }} className="ac-mono flex-none text-nano text-accent-link">
                  {e.ticketIdentifier}
                </A>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-meta text-text-2">{e.summary}</span>
              <span className="ac-mono flex-none text-nano text-text-4">{ago(e.at)}</span>
            </li>
          ))}
        </ul>
      )}

      <A to="/v2/w/$ws/changelog" params={{ ws }} className="v2-link text-micro font-medium">
        Open the full changelog
      </A>
    </div>
  );
}

/** The project's knowledge: the hub's sections, its linked documents and its health. */
function KnowledgeSection({ project, ws }: V2ProjectSectionProps): React.ReactElement {
  const hub = useKnowledgeDoc('project', project.id);
  const docs = useKnowledgeDocs(project.id);
  const health = useKnowledgeHealth(project.id);
  const sections = knowledgeSections(hub.data?.body);
  const linked = (docs.data ?? []).filter((d) => d.scope === 'project');

  if (hub.isLoading) return <SkeletonRows rows={3} />;

  const orphans = health.data?.orphans.length ?? 0;
  const stale = health.data?.stale.length ?? 0;
  const unresolved = health.data?.unresolvedLinks.length ?? 0;

  return (
    <div className="flex flex-col gap-3.5">
      {hub.data ? (
        <BudgetMeter
          label={`${projectLabel(project)} · project KB`}
          used={hub.data.tokenEstimate}
          budget={hub.data.budgetTokens}
          lastCuratedAt={hub.data.lastCuratedAt}
          curationPending={hub.data.curationPending}
        />
      ) : null}

      {sections.length === 0 ? (
        <p className="text-meta text-text-3">This project has no knowledge file yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {sections.map((s) => (
            <li key={s.name} className="v2-tag text-text-3" title={s.body ? undefined : 'nothing written yet'}>
              {s.name}
              {s.body ? '' : ' ·'}
            </li>
          ))}
        </ul>
      )}

      <div>
        <div className="ac-label mb-1.5">Documents</div>
        {docs.isLoading ? (
          <SkeletonRows rows={2} />
        ) : linked.length === 0 ? (
          <p className="text-meta text-text-3">No linked documents in this project.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {linked.map((d) => (
              <li key={d.path} className="flex items-center gap-2 px-1">
                <span className="ac-mono flex-none text-nano text-text-3">{d.slug}</span>
                <span className="min-w-0 flex-1 truncate text-meta text-text-2">{d.title}</span>
                <span className="ac-mono flex-none text-nano text-text-4">{ago(d.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="ac-label mb-1.5">Knowledge health</div>
        {orphans === 0 && stale === 0 && unresolved === 0 ? (
          <p className="text-meta text-text-3">No orphan documents, no stale documents, no unresolved links.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {orphans > 0 ? <span className="v2-tag text-text-3">{orphans} with no backlink</span> : null}
            {stale > 0 ? <span className="v2-tag text-text-3">{stale} not updated in 90 days</span> : null}
            {unresolved > 0 ? <span className="v2-tag text-text-3">{unresolved} unresolved link{unresolved === 1 ? '' : 's'}</span> : null}
          </div>
        )}
      </div>

      <A to="/v2/w/$ws/knowledge" params={{ ws }} search={{ project: project.id }} className="v2-link text-micro font-medium">
        Open this project's knowledge
      </A>
    </div>
  );
}

/** The sections, in the order they are shown. */
export const V2_PROJECT_SECTIONS: readonly V2ProjectSectionDef[] = [
  { key: 'needs', label: 'Needs you', column: 'side', Body: NeedsYouSection },
  { key: 'work', label: 'Work under way', column: 'main', Body: WorkSection },
  { key: 'roadmap', label: 'Roadmap', column: 'main', Body: RoadmapSection },
  { key: 'history', label: 'History', column: 'main', Body: HistorySection },
  { key: 'pulls', label: 'Pull requests', column: 'main', Body: PullRequestsSection },
  { key: 'landings', label: 'Recent landings', column: 'side', Body: LandingsSection },
  { key: 'activity', label: 'Activity', column: 'main', Body: ActivitySection },
  { key: 'knowledge', label: 'Knowledge', column: 'side', Body: KnowledgeSection },
];
