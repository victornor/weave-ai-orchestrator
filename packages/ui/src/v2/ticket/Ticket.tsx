/**
 * V2's ticket page (VS-346): the design header, its tabs — Overview, Plan and (when the ticket has
 * one) Artifacts — and the kept V1 ticket actions (auto-merge, priority, retry, cancel, discard,
 * reassign, blockers) in the header's overflow menu. Overview is one scrolling page: a two-pane
 * overview/Activity split over the Work, Usage and Knowledge sections (captain's 2026-09-13 layout).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { deliveryBadgeOf, isActiveRun, openspecArchive, projectLabel, ticketUiStatus, carriesWeaverReview, type Project, type Run, type Ticket, type TicketAttachment } from '@weave-ai/shared';
import { workerPauseDetail } from '@weave-ai/render';
import { A, useGo, useSearchParams } from '../../app/link';
import { useWs } from '../../api/context';
import { useRunEventStream } from '../../api/runStream';
import { Tabs } from '../../components/Tabs';
import { StatusGlyph, Badge } from '../../components/StatusGlyph';
import { Button } from '../../components/Button';
import { Markdown } from '../../components/Markdown';
import { DecisionCard } from '../../components/DecisionCard';
import { Composer } from '../../components/Composer';
import { RunTranscript } from '../../components/RunTranscript';
import { Table } from '../../components/Table';
import { StatTile } from '../../components/Chart';
import { Skeleton, SkeletonRows } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/States';
import { ArtifactInline } from '../artifact/Artifact';
import {
  useAnswerDecision,
  useAssignTicket,
  useCancelTicket,
  useDecisions,
  useDiscardTicket,
  usePatchTicket,
  usePostComment,
  useRetryTicket,
  useRoles,
  useSetTicketBlockers,
  useTicket,
  useTicketComments,
  useTicketDocument,
  useTicketDocumentRevisions,
  useTicketKnowledgeUsage,
  useTicketRuns,
  useTicketUsage,
  useTicketWorkProducts,
  useWorker,
  useWorkerMessage,
  useWorkers,
} from '../../api/hooks';
import { useWorkerActivity } from '../../api/workerActivity';
import { LiveActivityLine, type LiveActivityLineModel } from '../../components/LiveActivityLine';
import { isLiveWorker, liveWorkersByTicket, ticketBoardStatus } from '../../lib/board';
import { ticketAssigneeLabel } from '../work/board';
import { lastLinesByAgent } from '../../lib/projectOverview';
import { activityLine, mergeWorkerActivity } from '../../lib/workerActivity';
import { projectColorVar } from '../../lib/projectColor';
import { ago, cents, duration, statusText, tokens } from '../../lib/format';
import { cx } from '../../lib/cx';
import { AttachmentItem } from '../../components/AttachmentItem';

const TABS = [
  { key: 'artifacts', label: 'Artifacts' },
  { key: 'overview', label: 'Overview' },
  { key: 'plan', label: 'Plan' },
] as const;
/** Only the V2 tabs are addressable; the values the old separate tabs used now land on Overview. */
const LEGACY_TABS = new Set(['activity', 'work', 'usage', 'knowledge']);
const resolveTab = (key: string | undefined): string => {
  if (key === 'overview' || key === 'plan' || key === 'artifacts') return key;
  if (key && LEGACY_TABS.has(key)) return 'overview';
  return '';
};

export function V2TicketScreen(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const search = useSearchParams();
  const { ticketId } = useParams({ strict: false }) as { ticketId: string };
  const detail = useTicket(ticketId);
  const products = useTicketWorkProducts(detail.data?.ticket.id ?? '');
  // The ticket's own worker and what it is doing now (VS-368): the same workers read, runs and stream
  // the V2 Work screen uses, so the two surfaces cannot disagree about a live ticket.
  const workers = useWorkers({});
  const activity = useWorkerActivity();
  const runs = useTicketRuns(detail.data?.ticket.id ?? '');
  const hasArtifacts = (products.data ?? []).some((p) => p.type === 'artifact');
  const visibleTabs = useMemo(() => TABS.filter((t) => t.key !== 'artifacts' || hasArtifacts), [hasArtifacts]);

  const ticketRow = detail.data?.ticket;
  const liveWorker = useMemo(
    () => (ticketRow ? liveWorkersByTicket(workers.data ?? []).get(ticketRow.id) : undefined),
    [workers.data, ticketRow],
  );
  const liveLine = useMemo(() => {
    if (!liveWorker) return null;
    const summary = mergeWorkerActivity(liveWorker, activity);
    const runLine = lastLinesByAgent(runs.data ?? []).get(liveWorker.id) ?? null;
    return activityLine(summary, runLine) ?? { label: 'Working', since: null };
  }, [liveWorker, activity, runs.data]);

  const [tab, setTab] = useState<string>(() => resolveTab(search['tab']));
  useEffect(() => {
    const fromUrl = resolveTab(search['tab']);
    if (fromUrl) setTab(fromUrl);
  }, [search['tab']]);
  // Default to Artifacts when the ticket has one, Overview otherwise. A URL-named tab always wins.
  useEffect(() => {
    if (!resolveTab(search['tab'])) setTab(hasArtifacts ? 'artifacts' : 'overview');
  }, [hasArtifacts, search]);

  const chooseTab = (key: string): void => {
    setTab(key);
    go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId }, search: { ...search, tab: key }, replace: true });
  };

  if (detail.isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col p-4">
        <Skeleton className="mb-3 h-4 w-48" />
        <SkeletonRows rows={5} />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="flex h-full min-h-0 flex-col p-4">
        <ErrorState
          code="TICKET_NOT_FOUND"
          message={`No ticket ${ticketId} in this workspace.`}
          actions={
            <Button variant="link" onClick={() => go('/w/$ws/work', { params: { ws } })}>
              Back to Work
            </Button>
          }
        />
      </div>
    );
  }

  const { ticket, project, worker } = detail.data;
  const ui = ticketBoardStatus(ticket.status, { live: Boolean(liveWorker) });
  const pauseDetail = worker ? workerPauseDetail(worker) : null;
  const pausedFor = pauseDetail?.summary ?? null;
  const usage = detail.data.usage;
  const usageLine = usage ? `${tokens(usage.tokensIn + usage.tokensOut)} tok · ${cents(usage.costCents)}` : '';
  const active = resolveTab(tab) || (hasArtifacts ? 'artifacts' : 'overview');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TicketHeader ws={ws} detail={detail.data} ui={ui} pausedFor={pausedFor} usageLine={usageLine} liveLine={liveLine} />
      <Tabs items={visibleTabs} active={active} onChange={chooseTab} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        {active === 'artifacts' ? (
          <ArtifactInline ws={ws} ticketId={ticket.id} detail={detail.data} products={products.data} />
        ) : active === 'plan' ? (
          <PlanTab ticket={ticket} project={project} />
        ) : (
          <OverviewPage ticket={ticket} worker={worker} project={project} attachments={detail.data.attachments ?? []} />
        )}
      </div>
    </div>
  );
}

function TicketHeader({
  ws,
  detail,
  ui,
  pausedFor,
  usageLine,
  liveLine,
}: {
  ws: string;
  detail: NonNullable<ReturnType<typeof useTicket>['data']>;
  ui: ReturnType<typeof ticketUiStatus>;
  pausedFor: string | null;
  usageLine: string;
  liveLine: LiveActivityLineModel | null;
}): React.ReactElement {
  const { ticket, project, worker } = detail;
  const deliveryBadge = deliveryBadgeOf(project ?? null, ticket);
  // VS-550: same label as Work — the live worker while one holds the ticket, else the role that did
  // it, so a landed ticket names a role instead of reading `unassigned`.
  const assigneeLabel = ticketAssigneeLabel({
    liveWorkerName: isLiveWorker(worker) ? worker!.name : null,
    roleName: detail.role?.name ?? null,
    historicalWorkerName: worker?.name ?? null,
  });
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  // VS-469: an `in_review`/`proposed` ticket whose live open approval is still unseen is waiting on
  // the weaver, not on the human — say so in the header rather than only showing the ticket status.
  const awaitsReview = useMemo(() => {
    if (ticket.status !== 'in_review' && ticket.status !== 'proposed') return false;
    return (decisions.data ?? []).some(
      (d) => d.status === 'open' && carriesWeaverReview(d.kind)
        && (d.ticketId === ticket.id || d.ticketId === ticket.identifier)
        && (d.weaverReviewStatus ?? 'unseen') === 'unseen',
    );
  }, [decisions.data, ticket.id, ticket.identifier, ticket.status]);
  return (
    <header className="flex-none border-b border-line-1 px-4 py-3 md:px-5" data-v2-ticket-header>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="ac-mono text-micro text-accent-link">{ticket.identifier}</span>
        <span className="v2-tag text-text-3">{ticket.kind}</span>
        <span className="flex items-center gap-1.5 text-micro text-text-2">
          <StatusGlyph status={ui} size="xs" pulse={ui === 'working'} />
          {statusText(ticket.status)}
        </span>
        {deliveryBadge ? <span className="v2-tag text-text-2" data-v2-delivery-badge={deliveryBadge.state}>{deliveryBadge.state === 'in_production' ? 'in production' : `on ${deliveryBadge.branch}`}</span> : null}
        {ticket.interactiveSession ? <Badge tone="accent">interactive</Badge> : null}
        {awaitsReview ? <span className="v2-tag text-text-3" data-v2-awaits-review>Waiting on the weaver&rsquo;s review</span> : null}
        <div className="flex-1" />
        <RetryAction ticket={ticket} worker={worker} />
        <AutoMergeToggle ticket={ticket} />
        <TicketActionsMenu ticket={ticket} blockers={detail.blockers} />
      </div>
      <h1 className="mb-1.5 text-head font-semibold tracking-head text-text-strong">{ticket.title}</h1>
      <div className="flex flex-wrap items-center gap-2 text-micro text-text-3">
        {project ? (
          <span className="v2-tag" style={{ color: projectColorVar(project.id, []) }} data-project-color>
            {projectLabel(project)}
          </span>
        ) : null}
        <span data-v2-assignee>{assigneeLabel}</span>
        {detail.plan ? (
          <span className="flex items-center gap-1.5" data-v2-plan-origin={detail.plan.dispatched ? 'dispatched' : 'submission'}>
            <A to="/w/$ws/chat" params={{ ws }} className="v2-link">
              plan · {detail.plan.planTitle ?? 'untitled plan'}
            </A>
            <span>{detail.plan.dispatched ? '· dispatched while drafting' : '· filed at submission'}</span>
          </span>
        ) : null}
        {usageLine ? <span className="ac-mono">{usageLine}</span> : null}
        {pausedFor ? <span className="ac-mono">paused · {pausedFor}</span> : null}
        <A to="/w/$ws/work" params={{ ws }} className="v2-link ml-auto">
          Work
        </A>
      </div>
      <div className="mt-2">
        <LiveActivityLine line={liveLine} />
      </div>
    </header>
  );
}

function RetryAction({ ticket, worker }: { ticket: Ticket; worker: { status: string } | null }): React.ReactElement | null {
  const retry = useRetryTicket();
  const canRetry = ticket.status === 'blocked' || worker?.status === 'paused' || worker?.status === 'error';
  if (!canRetry) return null;
  return (
    <Button size="sm" variant="primary" onClick={() => retry.mutate({ id: ticket.id })} disabled={retry.isPending}>
      {worker?.status === 'paused' ? 'Resume' : 'Retry'}
    </Button>
  );
}

function AutoMergeToggle({ ticket }: { ticket: Ticket }): React.ReactElement {
  const patch = usePatchTicket();
  return (
    <label className="flex items-center gap-2">
      <span className="text-micro text-text-3">auto-merge</span>
      <button
        type="button"
        role="switch"
        aria-checked={ticket.autoMerge}
        aria-label="Auto-merge"
        onClick={() => patch.mutate({ id: ticket.id, patch: { autoMerge: !ticket.autoMerge } })}
        className={cx(
          'flex h-5 w-9 items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-ac',
          ticket.autoMerge ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
        )}
      >
        <span className={cx('size-3.5 rounded-pill', ticket.autoMerge ? 'bg-accent-on' : 'bg-text-nav')} />
      </button>
    </label>
  );
}

function TicketActionsMenu({ ticket, blockers }: { ticket: Ticket; blockers: Ticket[] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<'cancel' | 'discard' | null>(null);
  const patch = usePatchTicket();
  const cancel = useCancelTicket();
  const discard = useDiscardTicket();
  const assign = useAssignTicket();
  const setBlockers = useSetTicketBlockers();
  const roles = useRoles();
  const [reason, setReason] = useState('');
  const [roleId, setRoleId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const reasonOk = reason.trim().length > 0;

  return (
    <div className="relative">
      <Button size="sm" variant="ghost" aria-expanded={open} aria-haspopup="menu" onClick={() => { setOpen((v) => !v); setConfirming(null); setNotice(null); }}>
        Actions
      </Button>
      {open ? (
        <div role="menu" aria-label="Ticket actions" className="v2-anim-menu v2-card absolute right-0 z-30 mt-1 flex w-64 flex-col gap-2 p-3 shadow-float">
          <label className="flex items-center justify-between gap-2">
            <span className="text-micro text-text-3">Priority</span>
            <select
              aria-label="Priority"
              value={ticket.priority}
              onChange={(e) => patch.mutate({ id: ticket.id, patch: { priority: e.target.value as Ticket['priority'] } })}
              className="h-7 rounded-r4 border border-line-2 bg-bg-input px-1.5 text-micro text-text-1"
            >
              {(['critical', 'high', 'medium', 'low'] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1.5">
            <select
              aria-label="Reassign role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="h-7 min-w-0 flex-1 rounded-r4 border border-line-2 bg-bg-input px-1.5 text-micro text-text-1"
            >
              <option value="">role…</option>
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" disabled={!roleId || assign.isPending} onClick={() => assign.mutate({ id: ticket.id, roleId })}>
              Assign
            </Button>
          </div>

          <button
            type="button"
            disabled={blockers.length === 0 || setBlockers.isPending}
            onClick={() => setBlockers.mutate({ id: ticket.id, blockedBy: [] })}
            className="text-left text-micro text-text-2 hover:text-text-1 disabled:text-text-4"
          >
            Clear blockers ({blockers.length})
          </button>

          <div className="border-t border-line-1 pt-2">
            <label className="mb-1.5 flex flex-col gap-1">
              <span className="text-micro text-text-3">Cancel reason (required)</span>
              <input
                aria-label="Cancel reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-7 rounded-r4 border border-line-2 bg-bg-input px-1.5 text-micro text-text-1"
              />
            </label>
            <div className="flex gap-1.5">
              {confirming === 'cancel' ? (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!reasonOk || cancel.isPending}
                  onClick={() => { cancel.mutate({ id: ticket.id, reason: reason.trim() }); setConfirming(null); }}
                >
                  Confirm cancel
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setConfirming('cancel')}>
                  Cancel ticket
                </Button>
              )}
              {confirming === 'discard' ? (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={discard.isPending}
                  onClick={() =>
                    discard.mutate(
                      { id: ticket.id },
                      {
                        onSuccess: (r) =>
                          setNotice(
                            r.discarded
                              ? 'Work discarded.'
                              : 'A discard approval is now waiting for you — approve it to discard this work.',
                          ),
                      },
                    )
                  }
                >
                  Confirm discard
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setConfirming('discard')}>
                  Discard work
                </Button>
              )}
            </div>
            {!reasonOk ? <p className="mt-1 text-nano text-text-4">A reason is needed before cancelling.</p> : null}
            {cancel.isError ? (
              <p role="alert" data-v2-cancel-error className="mt-1 text-nano text-failed">
                {cancel.error?.message ?? 'The cancel failed.'}
              </p>
            ) : null}
            {discard.isError ? (
              <p role="alert" data-v2-discard-error className="mt-1 text-nano text-failed">
                {discard.error?.message ?? 'The discard failed.'}
              </p>
            ) : null}
            {notice ? (
              <p role="status" data-v2-discard-notice className="mt-1 text-nano text-text-2">
                {notice}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Facts({ title, rows }: { title: string; rows: Array<[string, string]> }): React.ReactElement {
  return (
    <div className="v2-card p-3.5">
      <div className="ac-label mb-2.5">{title}</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-micro text-text-3">{k}</dt>
            <dd className="ac-mono text-micro text-text-1">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OverviewPane({ ticket }: { ticket: Ticket }): React.ReactElement {
  const detail = useTicket(ticket.id);
  const d = detail.data;
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const answer = useAnswerDecision();
  const retryDecision = (decisions.data ?? []).find(
    (dec) => dec.kind === 'retry_approval' && (dec.ticketId === ticket.id || dec.ticketId === ticket.identifier),
  );
  // VS-550: the Delivery row names the role once the worker is gone, matching Work's label.
  const assigneeLabel = ticketAssigneeLabel({
    liveWorkerName: d?.worker && isLiveWorker(d.worker) ? d.worker.name : null,
    roleName: d?.role?.name ?? null,
    historicalWorkerName: d?.worker?.name ?? null,
  });
  return (
    <div className="flex min-w-0 flex-col gap-5" data-v2-overview-pane>
      {retryDecision ? (
        <>
          <DecisionCard
            decision={retryDecision}
            ticketIdentifier={ticket.identifier}
            projectSlug={d?.project?.slug}
            projectLabel={d?.project ? projectLabel(d.project) : null}
            busy={answer.isPending}
            onAnswer={(a) => answer.mutate({ id: retryDecision.id, ...a })}
          />
          <AnswerError error={answer.error} />
        </>
      ) : null}
      <Markdown source={ticket.description || '_No description._'} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Facts
          title="Ticket"
          rows={[
            ['kind', ticket.kind],
            ['priority', ticket.priority],
            ['status', statusText(ticket.status)],
            ['created', ago(ticket.createdAt)],
          ]}
        />
        <Facts
          title="Delivery"
          rows={[
            ['project', d?.project ? projectLabel(d.project) : '—'],
            ['worker', assigneeLabel],
            ['branch', d?.worker?.branch ?? '—'],
            ['auto-merge', ticket.autoMerge ? 'on' : 'off'],
          ]}
        />
      </div>
      {d?.blockers.length ? (
        <section>
          <div className="ac-label mb-2">Blocked by</div>
          <div className="v2-card divide-y divide-line-1">
            {d.blockers.map((b) => (
              <div key={b.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                <StatusGlyph status={ticketUiStatus(b.status)} size="xs" />
                <span className="ac-mono text-micro text-text-3">{b.identifier}</span>
                <span className="min-w-0 flex-1 truncate text-meta text-text-1">{b.title}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The Overview tab: one scrolling page. A two-pane split (the overview on the left, Activity on the
 * right) over the Work, Usage and Knowledge sections, in captain's order (VS-346 review).
 */
function OverviewPage({
  ticket,
  worker,
  project,
  attachments,
}: {
  ticket: Ticket;
  worker: { id: string; name: string; status: string } | null;
  project: Project | null;
  attachments: TicketAttachment[];
}): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-7" data-v2-overview-page>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <OverviewPane ticket={ticket} />
        <ActivityPane ticket={ticket} worker={worker} project={project} />
      </div>
      <AttachmentsSection attachments={attachments} />
      <WorkSection ticket={ticket} />
      <UsageSection ticketId={ticket.id} />
      <KnowledgeSection ticketId={ticket.id} />
    </div>
  );
}

function AttachmentsSection({ attachments }: { attachments: TicketAttachment[] }): React.ReactElement | null {
  if (!(attachments ?? []).length) return null;
  return (
    <section className="flex flex-col gap-3" data-v2-section="attachments">
      <h2 className="text-head font-semibold text-text-strong">Attachments</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(attachments ?? []).map((attachment) =>
          attachment.mediaType.startsWith('image/') ? (
            <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="v2-card overflow-hidden p-2.5 hover:border-accent-edge">
              {attachment.url ? <img src={attachment.url} alt={attachment.label} className="mb-2 max-h-56 w-full rounded-r4 object-contain" /> : null}
              <div className="truncate text-micro text-text-1">{attachment.label}</div>
              <div className="ac-mono text-nano text-text-3">{attachment.mediaType} · {attachment.byteSize.toLocaleString()} bytes</div>
            </a>
          ) : attachment.url ? (
            <AttachmentItem key={attachment.id} attachmentId={attachment.id} url={attachment.url} label={attachment.label} mediaType={attachment.mediaType} byteSize={attachment.byteSize} createdAt={attachment.createdAt} />
          ) : null,
        )}
      </div>
    </section>
  );
}

function PlanTab({ ticket, project }: { ticket: Ticket; project: Project | null }): React.ReactElement {
  const ws = useWs();
  const [revision, setRevision] = useState<number | undefined>();
  const doc = useTicketDocument(ticket.id, 'plan', revision);
  const revisions = useTicketDocumentRevisions(ticket.id, 'plan');
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const answer = useAnswerDecision();
  const planDecision = (decisions.data ?? []).find(
    (d) => d.kind === 'plan_approval' && (d.ticketId === ticket.id || d.ticketId === ticket.identifier),
  );
  const body = doc.data?.body?.trim() ?? '';
  const missing = !doc.isLoading && (doc.isError || body.length === 0);
  if (doc.isLoading) return <SkeletonRows rows={5} />;
  if (missing && !planDecision) {
    return <EmptyState title="No plan yet — the worker is proposing." detail="The plan arrives as a decision card when it is ready." />;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* The real decision card handles the held/unreviewed states and the reason-required override
          (VS-266/VS-281); Approve alone would be refused server-side with `revision_pending`. */}
      {planDecision ? (
        <>
          <DecisionCard
            decision={planDecision}
            ticketIdentifier={ticket.identifier}
            projectSlug={project?.slug}
            projectLabel={project ? projectLabel(project) : null}
            ws={ws}
            busy={answer.isPending}
            plan={missing ? undefined : <Markdown source={body} />}
            onAnswer={(a) => answer.mutate({ id: planDecision.id, ...a })}
          />
          <AnswerError error={answer.error} />
        </>
      ) : null}
      {!missing && (revisions.data?.length ?? 0) > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="ac-label">Revisions</span>
          {(revisions.data ?? []).map((r) => (
            <button
              key={r.revision}
              type="button"
              onClick={() => setRevision(r.revision)}
              className={cx(
                'ac-mono rounded-r4 border px-2 py-1 text-nano',
                (revision ?? doc.data?.revision) === r.revision ? 'border-accent-edge bg-accent-tint text-accent-link' : 'border-line-2 text-text-3',
              )}
              title={r.reason ?? ''}
            >
              r{r.revision}
            </button>
          ))}
        </div>
      ) : null}
      {missing ? (
        <EmptyState title="No plan document on this ticket." detail="The worker's proposal is missing or empty — ask it to re-propose before approving." />
      ) : planDecision ? null : (
        <Markdown source={body} />
      )}
    </div>
  );
}

/** The mutation error an answer can produce, shown on the page rather than swallowed (VS-346 review). */
function AnswerError({ error }: { error: unknown }): React.ReactElement | null {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'The answer failed.';
  return (
    <p role="alert" data-v2-answer-error className="text-micro text-failed">
      {message}
    </p>
  );
}


function ActivityPane({ ticket, worker, project }: { ticket: Ticket; worker: { id: string; name: string; status: string } | null; project: Project | null }): React.ReactElement {
  const ws = useWs();
  const comments = useTicketComments(ticket.id);
  const runs = useTicketRuns(ticket.id);
  const post = usePostComment();
  const retired = worker?.status === 'retired';
  const canConverse = Boolean(worker) && !retired && worker!.status !== 'paused' && worker!.status !== 'error';
  const workerDetail = useWorker(canConverse ? worker!.id : '');
  const message = useWorkerMessage();
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  useEffect(() => setLastOutcome(null), [worker?.id]);
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const answer = useAnswerDecision();
  const mergeDecision = (decisions.data ?? []).find(
    (d) => d.kind === 'merge_approval' && (d.ticketId === ticket.id || d.ticketId === ticket.identifier),
  );

  const feed = useMemo(() => {
    const items: Array<{ at: string; key: string; node: React.ReactNode }> = [];
    for (const c of comments.data ?? []) {
      items.push({
        at: c.createdAt,
        key: `c-${c.id}`,
        node: (
          <article className={cx('v2-card p-3.5', c.authorKind === 'human' && 'border-accent-edge')}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-micro font-medium text-text-soft">
                {c.authorKind === 'human' ? 'You' : c.authorKind === 'agent' ? (worker?.name ?? 'Worker') : 'System'}
              </span>
              {c.kind !== 'comment' ? <Badge>{c.kind}</Badge> : null}
              <div className="flex-1" />
              <span className="ac-mono text-nano text-text-4">{ago(c.createdAt)}</span>
            </div>
            <Markdown source={c.body} breaks />
          </article>
        ),
      });
    }
    for (const r of runs.data ?? []) {
      items.push({ at: r.finishedAt ?? r.startedAt ?? r.createdAt, key: `r-${r.id}`, node: <RunTurn run={r} /> });
    }
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [comments.data, runs.data, worker?.name]);

  const ended = ticket.status === 'done' || ticket.status === 'cancelled';
  const steerLabel = canConverse && workerDetail.data
    ? lastOutcome ??
      (workerDetail.data.input.midTurn
        ? 'Reaches the running turn immediately.'
        : workerDetail.data.input.interrupts
          ? 'Interrupts the running turn; the agent answers once its next turn starts.'
          : `Queued for the next turn${workerDetail.data.input.reason ? ` — ${workerDetail.data.input.reason}` : ''}.`)
    : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:max-h-[70vh] lg:overflow-y-auto" data-v2-activity-pane>
      {mergeDecision ? (
        <>
          <DecisionCard
            decision={mergeDecision}
            ticketIdentifier={ticket.identifier}
            delivery={ticket.delivery}
            projectSlug={project?.slug}
            projectLabel={project ? projectLabel(project) : null}
            ws={ws}
            busy={answer.isPending}
            onAnswer={(a) => answer.mutate({ id: mergeDecision.id, ...a })}
          />
          <AnswerError error={answer.error} />
        </>
      ) : null}
      {comments.isLoading || runs.isLoading ? (
        <SkeletonRows rows={4} />
      ) : feed.length === 0 ? (
        <EmptyState title="Nothing has happened yet." detail="Your replies, the worker's messages and its turns land here, in order." />
      ) : (
        <div className="flex flex-col gap-3">
          {feed.map((f) => (
            <div key={f.key}>{f.node}</div>
          ))}
        </div>
      )}
      {canConverse ? (
        <Composer
          placeholder={`Ask ${worker!.name}…`}
          submitLabel="Send"
          queuedReason={steerLabel}
          onSubmit={async (body) => {
            const outcome = await message.mutateAsync({ id: worker!.id, ticketId: ticket.id, body, live: true });
            setLastOutcome(
              outcome.delivery === 'mid_turn'
                ? 'Delivered to the running turn.'
                : outcome.delivery === 'interrupted'
                  ? 'Interrupted the running turn; it will be answered once the next turn starts.'
                  : 'Queued for the next turn.',
            );
          }}
        />
      ) : (
        <Composer
          placeholder={ended ? 'Reply to reopen this ticket…' : 'Reply — a worker is started for this ticket…'}
          submitLabel="Reply"
          onSubmit={(body) => post.mutate({ id: ticket.id, body })}
        />
      )}
    </div>
  );
}

function RunTurn({ run }: { run: Run }): React.ReactElement {
  const live = isActiveRun(run.status);
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current !== live) setOpen(live);
    wasLive.current = live;
  }, [live]);
  const stream = useRunEventStream(open ? run.id : null, { live });
  const { events } = stream;
  const at = run.finishedAt ?? run.startedAt ?? run.createdAt;
  const status = run.status === 'running' ? 'working' : run.status === 'succeeded' ? 'done' : run.status === 'interrupted' || run.status === 'cancelled' ? 'paused' : 'failed';
  return (
    <div className="flex items-start gap-2.5 px-1 py-1">
      <StatusGlyph status={status} size="xs" pulse={live} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-micro text-text-3">
          <span>turn {run.turnEpoch}</span>
          <span>·</span>
          <span>{run.status}</span>
          <span>·</span>
          <span className="ac-mono">{ago(at)}</span>
          <div className="flex-1" />
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-r4 px-1.5 py-0.5 text-nano text-text-4 hover:bg-bg-3 hover:text-text-1">
            {open ? 'hide transcript' : 'show transcript'}
          </button>
        </div>
        {run.summary ? <p className="mt-0.5 text-meta leading-relaxed text-text-body">{run.summary}</p> : null}
        {open ? (
          <div className="v2-anim-fade v2-card mt-2 overflow-hidden">
            <RunTranscript events={events} live={live} stream={stream} runtimeId={run.runtimeId} label={`Transcript of turn ${run.turnEpoch}`} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkSection({ ticket }: { ticket: Ticket }): React.ReactElement {
  const detail = useTicket(ticket.id);
  const products = useTicketWorkProducts(ticket.id);
  const runs = useTicketRuns(ticket.id);
  const spec = detail.data?.openspecState;
  const archive = openspecArchive(ticket);
  const done = spec?.tasks.filter((t) => t.done).length ?? 0;
  const total = spec?.tasks.length ?? 0;
  return (
    <section className="flex flex-col gap-5" data-v2-section="work">
      <h2 className="text-head font-semibold text-text-strong">Work</h2>
      <section>
        <div className="ac-label mb-2">Work products</div>
        {products.isLoading ? (
          <SkeletonRows rows={2} />
        ) : (products.data?.length ?? 0) === 0 ? (
          <EmptyState title="No branch or PR yet." detail="They appear as the worker pushes." />
        ) : (
          <div className="v2-card divide-y divide-line-1">
            {(products.data ?? []).map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <Badge>{p.type}</Badge>
                <span className="ac-mono min-w-0 flex-1 truncate text-micro text-text-2">{p.title ?? p.externalId ?? p.url ?? '—'}</span>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-micro text-accent-link">
                    open ↗
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
      {spec ? (
        <section>
          <div className="ac-label mb-2">
            OpenSpec · {spec.changeName ?? 'change'} · {done}/{total} tasks
          </div>
          <div className="mb-2.5 h-1.5 overflow-hidden rounded-pill bg-bg-3">
            <div className="h-full bg-done" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <ul className="v2-card divide-y divide-line-1">
            {spec.tasks.map((t, i) => (
              <li key={i} className="flex items-start gap-2.5 px-3.5 py-2">
                <span className={cx('mt-0.5 size-3 flex-none rounded-r4 border', t.done ? 'border-done bg-done/20' : 'border-line-3')} aria-hidden />
                <span className={cx('text-meta', t.done ? 'text-text-3 line-through' : 'text-text-1')}>{t.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {archive && archive.state === 'pending' && archive.pendingPrUrl ? (
        <section data-v2-archive-pending>
          <div className="ac-label mb-2">Spec archive</div>
          <div className="v2-card flex items-center gap-3 px-3.5 py-2.5">
            <span className="v2-tag text-needs-you">spec archive pending</span>
            <a href={archive.pendingPrUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-micro text-accent-link">
              {archive.pendingPrUrl}
            </a>
          </div>
        </section>
      ) : null}
      <section>
        <div className="ac-label mb-2">Worktree</div>
        <div className="v2-card px-3.5 py-2.5">
          <span className="ac-mono text-micro text-text-2">
            {detail.data?.worker?.worktreePath ?? 'no worktree'} · {detail.data?.worker?.branch ?? 'no branch'}
          </span>
        </div>
      </section>
      <section>
        <div className="ac-label mb-2">Runs</div>
        <Table
          rows={runs.data ?? []}
          rowKey={(r) => r.id}
          emptyLabel="No runs yet."
          columns={[
            { key: 'status', header: 'Status', width: '7rem', mono: true, render: (r) => r.status },
            { key: 'model', header: 'Model', mono: true, render: (r) => r.model ?? '—' },
            { key: 'tok', header: 'Tokens', align: 'right', mono: true, render: (r) => tokens((r.usage?.inputTokens ?? 0) + (r.usage?.outputTokens ?? 0)) },
            { key: 'cost', header: 'Cost', align: 'right', mono: true, render: (r) => cents(r.costCents) },
            { key: 'when', header: 'When', align: 'right', mono: true, render: (r) => ago(r.startedAt) },
          ]}
        />
      </section>
    </section>
  );
}

function UsageSection({ ticketId }: { ticketId: string }): React.ReactElement {
  const usage = useTicketUsage(ticketId);
  if (usage.isLoading) return <SkeletonRows rows={3} />;
  const total = usage.data?.total;
  const subtree = usage.data?.subtree;
  return (
    <section className="flex flex-col gap-4" data-v2-section="usage">
      <h2 className="text-head font-semibold text-text-strong">Usage</h2>
      <div className="flex gap-px overflow-hidden rounded-r6 border border-line-1 bg-line-1">
        <StatTile value={tokens((total?.tokensIn ?? 0) + (total?.tokensOut ?? 0))} caption="tokens on this ticket" />
        <StatTile value={cents(total?.costCents ?? null)} caption={`cost · ${total?.costStatus ?? 'unpriced'}`} muted />
        <StatTile value={String(total?.runs ?? 0)} caption="runs" muted />
        <StatTile value={duration(total?.durationMs ?? 0)} caption="agent time" muted />
      </div>
      {subtree ? (
        <div className="v2-card p-3.5">
          <div className="ac-label mb-2">Including children</div>
          <span className="ac-mono text-meta text-text-1">
            {tokens(subtree.tokensIn + subtree.tokensOut)} tok · {cents(subtree.costCents)} {subtree.costStatus}
          </span>
        </div>
      ) : null}
      {usage.data?.turns?.length ? (
        <Table
          rows={usage.data.turns}
          rowKey={(t) => t.runId}
          columns={[
            { key: 'run', header: 'Run', mono: true, render: (t) => t.runId.slice(0, 8) },
            { key: 'when', header: 'Started', mono: true, render: (t) => ago(t.startedAt) },
            { key: 'tok', header: 'Tokens', align: 'right', mono: true, render: (t) => tokens(t.tokens) },
            { key: 'cost', header: 'Cost', align: 'right', mono: true, render: (t) => cents(t.costCents) },
          ]}
        />
      ) : null}
    </section>
  );
}

function KnowledgeSection({ ticketId }: { ticketId: string }): React.ReactElement {
  const knowledge = useTicketKnowledgeUsage(ticketId);
  if (knowledge.isLoading) return <SkeletonRows rows={2} />;
  const k = knowledge.data;
  return (
    <section className="flex flex-col gap-3" data-v2-section="knowledge">
      <h2 className="text-head font-semibold text-text-strong">Knowledge</h2>
      <div className="flex gap-px overflow-hidden rounded-r6 border border-line-1 bg-line-1">
        <StatTile value={tokens(k?.totalTokens ?? 0)} caption="total knowledge tokens" muted />
        <StatTile value={tokens(k?.hubTokens ?? 0)} caption="hub (bootstrap)" muted />
        <StatTile value={tokens(k?.documentTokens ?? 0)} caption="documents read" muted />
      </div>
      {k?.documents.length ? (
        <Table
          rows={k.documents}
          rowKey={(d) => `${d.scope}:${d.projectId ?? ''}:${d.slug ?? ''}`}
          columns={[
            { key: 'scope', header: 'Scope', mono: true, render: (d) => d.scope },
            { key: 'slug', header: 'Document', render: (d) => d.slug ?? '(whole file)' },
            { key: 'tok', header: 'Tokens', align: 'right', mono: true, render: (d) => tokens(d.tokens) },
          ]}
        />
      ) : (
        <p className="text-micro text-text-3">This ticket's runs read only hub knowledge, no linked documents.</p>
      )}
    </section>
  );
}
