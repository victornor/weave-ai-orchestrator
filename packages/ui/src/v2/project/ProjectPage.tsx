/**
 * The V2 project overview (`/w/:ws/p/:project`, web-v2/project-overview): everything happening in
 * one project, in one place, in V2's Mono language.
 *
 * The page resolves the address against the project list the shell has already loaded — the daemon
 * accepts a slug or an id for the same project and so does this — and then owns only the header, the
 * about block and the layout. Each section reads its own data.
 */
import { useParams } from '@tanstack/react-router';
import { projectLabel } from '@weave-ai/shared';
import { V2Page } from '../V2Page';
import { A, useGo } from '../../app/link';
import { useWs } from '../../api/context';
import { useKnowledgeDoc, useProjectFetch, useProjectPromotion, useProjectSync, useRequestPromotion, useProjects, useWorkspaceSummary } from '../../api/hooks';
import { Markdown } from '../../components/Markdown';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState } from '../../components/States';
import { currentFocus, deliveryModeOf, resolveProject } from '../../lib/projectOverview';
import { projectYolo } from '../../lib/yolo';
import { cx } from '../../lib/cx';
import { V2_PROJECT_SECTIONS, V2ProjectSection } from './sections';

export function V2ProjectScreen(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const { project: param } = useParams({ strict: false }) as { project?: string };
  const projects = useProjects();
  const summary = useWorkspaceSummary();
  const project = resolveProject(projects.data ?? [], param);

  if (projects.isLoading) {
    return (
      <V2Page title="Project">
        <div className="p-4 md:p-5"><SkeletonRows rows={6} /></div>
      </V2Page>
    );
  }

  if (!project) {
    return (
      <V2Page title="Project" subtitle={param}>
        <div className="p-4 md:p-5">
          <EmptyState
            title="No such project in this workspace."
            detail={param ? <span className="ac-mono">{param}</span> : undefined}
            action={
              <button type="button" onClick={() => go(`/w/${ws}/work`)} className="rounded-r4 border border-line-2 px-3 py-1.5 text-micro text-text-2 hover:bg-bg-2">
                Open Work
              </button>
            }
          />
        </div>
      </V2Page>
    );
  }

  const delivery = deliveryModeOf(project, summary.data?.config);

  return (
    <V2Page
      title={projectLabel(project)}
      subtitle={project.slug}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <HeaderLink to="/w/$ws/work" ws={ws} search={{ project: project.id }} label="Work" />
          <HeaderLink to="/w/$ws/knowledge" ws={ws} search={{ project: project.id }} label="Knowledge" />
          <HeaderLink to="/w/$ws/chat" ws={ws} label="Chat" />
        </div>
      }
    >
      <div className="mx-auto flex max-w-[80rem] flex-col gap-4 p-4 md:p-5">
        <section aria-label="About this project" className="v2-card flex flex-col gap-2.5 p-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="ac-mono truncate text-micro text-text-2">{project.gitUrl}</span>
            <span className="v2-tag text-text-3">{project.defaultBranch}</span>
            <span className={cx('v2-tag', delivery.inherited ? 'text-text-3' : 'text-accent-link')}>
              {delivery.mode}
              {delivery.inherited ? ' · inherited' : ''}
            </span>
            {project.status !== 'ready' ? <span className="v2-tag text-working">{project.status}</span> : null}
            {projectYolo(project) ? <span className="v2-tag text-needs-you">YOLO mode — the daemon grants this project's plan and merge approvals; action approvals still come to you</span> : null}
            <ProjectSyncStatus projectId={project.id} />
          </div>
          <PromoteControl projectId={project.id} />
          <CurrentFocus projectId={project.id} />
        </section>

        {/* One flow: a phone reads it top to bottom, the desktop grid packs it into columns. */}
        <div className="grid grid-cols-1 gap-4 md:grid-flow-row-dense md:grid-cols-3">
          {V2_PROJECT_SECTIONS.map(({ key, label, column, Body }) => (
            <V2ProjectSection key={key} id={key} label={label} className={cx(column === 'main' && 'md:col-span-2')}>
              <Body project={project} ws={ws} />
            </V2ProjectSection>
          ))}
        </div>
      </div>
    </V2Page>
  );
}

/**
 * A project that is `in_sync` renders nothing. `behind` is the routine case and gets an unalarming
 * tone plus the one action that resolves it; `diverged` gets the alarm tone and says a human must
 * act outside Weave AI.
 */
function ProjectSyncStatus({ projectId }: { projectId: string }): React.ReactElement | null {
  const sync = useProjectSync(projectId);
  const fetchMutation = useProjectFetch(projectId);
  const state = sync.data?.syncState;
  if (!state || state === 'in_sync') return null;

  if (state === 'diverged') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="v2-tag text-failed">Diverged</span>
        <span className="text-micro text-text-2">the clone holds history the remote no longer recognises — a human must resolve this outside Weave AI</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="v2-tag text-working">{sync.data?.behindBy ?? '?'} behind</span>
      <button type="button" onClick={() => fetchMutation.mutate()} disabled={fetchMutation.isPending} className="rounded-r4 border border-line-2 px-2 py-1 text-micro text-text-2 hover:bg-bg-2 disabled:opacity-45">
        {fetchMutation.isPending ? 'Syncing…' : 'Sync'}
      </button>
    </span>
  );
}

/**
 * Land-then-promote (VS-568, VS-584): what a project's landing branch would promote, which tickets
 * wait, the pull request's progress once approval has opened one, and the one control that raises the
 * promotion approval. Tapping it asks the human (a card in Needs you); nothing here pushes.
 */
export function PromoteControl({ projectId }: { projectId: string }): React.ReactElement | null {
  const promotion = useProjectPromotion(projectId);
  const request = useRequestPromotion(projectId);
  const p = promotion.data;
  if (!p?.applicable) return null;
  const waiting = p.tickets.length;
  const held = p.promotion?.state === 'held' ? (p.promotion.heldReason ?? p.heldReason) : p.heldReason;
  const inFlight = p.promotion?.state === 'pending';
  return (
    <div aria-label="Promotion" className="flex flex-wrap items-center gap-2.5">
      <span className="v2-tag text-text-2">{p.changedFiles} file{p.changedFiles === 1 ? '' : 's'} changed to promote {p.landing} → {p.defaultBranch} ({p.strategy === 'pull-request' ? 'via pull request' : 'fast-forward'})</span>
      {waiting ? <span className="text-micro text-text-2">{waiting} ticket{waiting === 1 ? '' : 's'} waiting: {p.tickets.slice(0, 6).map((t) => t.identifier).join(', ')}{waiting > 6 ? '…' : ''}</span> : null}
      {p.behind > 0 ? <span className="v2-tag text-failed">{p.landing} is behind {p.defaultBranch} by {p.behind}</span> : null}
      {inFlight && p.promotion?.prUrl ? <a href={p.promotion.prUrl} target="_blank" rel="noreferrer" className="text-micro text-accent">promotion PR open — checks running</a> : null}
      {p.promotion?.state === 'merged' ? <span className="text-micro text-text-2">promoted</span> : null}
      {held ? <span className="text-micro text-text-2">{held}</span> : null}
      {p.changedFiles > 0 && !inFlight ? (
        <button type="button" onClick={() => request.mutate()} disabled={request.isPending || request.isSuccess}
          className="rounded-r4 border border-line-2 px-2 py-1 text-micro text-text-2 hover:bg-bg-2 disabled:opacity-45">
          {request.isSuccess ? 'Promotion raised: see Needs you' : request.isPending ? 'Raising…' : `Promote ${p.landing} to ${p.defaultBranch}`}
        </button>
      ) : !inFlight ? <span className="text-micro text-text-3">nothing to promote</span> : null}
      {request.isError ? <span className="text-micro text-failed">{request.error.message}</span> : null}
    </div>
  );
}

/** The project's Current focus, from its knowledge file; absent renders nothing. */
function CurrentFocus({ projectId }: { projectId: string }): React.ReactElement | null {
  const hub = useKnowledgeDoc('project', projectId);
  const focus = currentFocus(hub.data?.body);
  if (!focus) return null;
  return (
    <div>
      <div className="ac-label mb-1">Current focus</div>
      <Markdown className="text-meta text-text-2" source={focus} />
    </div>
  );
}

function HeaderLink({ to, ws, search, label }: { to: string; ws: string; search?: Record<string, unknown>; label: string }): React.ReactElement {
  return (
    <A to={to} params={{ ws }} {...(search ? { search } : {})} className="rounded-r4 border border-line-2 px-2 py-1 text-micro text-text-2 hover:bg-bg-2">
      {label}
    </A>
  );
}
