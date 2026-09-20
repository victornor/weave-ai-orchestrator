/**
 * A plan's tab surface (VS-556, from the VS-398 Plan modal): the planner conversation rendered
 * through the same shared view, composer and attachments as the weaver chat (VS-442), beside the
 * live draft list with per-draft edit, reorder, tier override, scout dispatch and Submit. It carries
 * none of the modal's chrome — no overlay, header, project picker or inner plan tab list; those are
 * the chat's tab strip's now.
 *
 * The planner files no tickets and raises no decisions, so the weaver-only extras (inline decision
 * cards, dispatch chips, the reply control and the unattributed-worker row) are omitted rather than
 * shown broken.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlanDraft, PlanDraftKind, Project, RunTrace, TicketPriority, WorkspaceEvent } from '@weave-ai/shared';
import { PLAN_DRAFT_KINDS, TICKET_PRIORITIES, projectLabel } from '@weave-ai/shared';
import { resolveModel } from '@weave-ai/render';
import {
  usePlan, usePatchPlanDraft, useRemovePlanDraft, useDispatchPlanDraft, useSubmitPlan,
  useThreadMessages, usePostThreadMessage, useRoles, useRunTraces, useRuntimes, useRuntimeModels,
} from '../api/hooks';
import { useConnection, useWorkspaceEvents } from '../api/context';
import { qk } from '../api/keys';
import { useGo } from '../app/link';
import { cx } from '../lib/cx';
import { chatEntries, chatRows } from '../lib/dispatch';
import { useNewOutboundMessageIds } from '../lib/streamReveal';
import { ChatComposer } from './ChatComposer';
import { ChatConversation, useLiveRunSettle } from './ChatConversation';
import type { ChatConversationHandle, LiveChatRun } from './ChatConversation';

const TIERS = ['quick', 'standard', 'deep'] as const;

export interface PlanTabProps {
  ws: string;
  projectId: string;
  planId: string;
  projects: Project[];
  /** Only the focused pane holds a live stream and answers the dictation hotkey (VS-199/VS-489). */
  focused: boolean;
  /** The planner runtime resolved when the tab was focused, for the turn summary's context figure. */
  plannerRuntimeId: string | null;
  /** The plan was submitted: the owner drops its tab and refocuses. */
  onSubmitted: (planId: string) => void;
}

export function PlanTab({ ws, projectId, planId, projects, focused, plannerRuntimeId, onSubmitted }: PlanTabProps): React.ReactElement {
  const [phoneTab, setPhoneTab] = useState<'chat' | 'drafts'>('chat');
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editKind, setEditKind] = useState<PlanDraftKind>('change');
  const [editPriority, setEditPriority] = useState<TicketPriority>('medium');
  const [editTargetRoleId, setEditTargetRoleId] = useState('');

  const conn = useConnection();
  const go = useGo();
  const qc = useQueryClient();
  // The planner's live turn, tracked exactly as the weaver chat tracks the weaver's: `fromStart` is
  // true only for a run this tab saw begin, so its first line streams (VS-440).
  const [live, setLive] = useState<LiveChatRun | null>(null);
  const conversationRef = useRef<ChatConversationHandle>(null);

  const plan = usePlan(projectId, planId);
  const roles = useRoles(projectId);
  const threadId = plan.data?.plan.threadId ?? null;
  const messages = useThreadMessages(threadId);
  const post = usePostThreadMessage();
  const patchDraft = usePatchPlanDraft();
  const removeDraft = useRemovePlanDraft();
  const dispatchDraft = useDispatchPlanDraft();
  const submit = useSubmitPlan();

  const plannerAgentId = plan.data?.plan.agentId ?? null;

  // A dispatched scout's ticket ids, so a `ticket.status` event for one of them refreshes the plan
  // the same way a `plan.*` event does (VS-517). Run events for the planner drive the live section.
  const dispatchedTicketIds = useMemo(
    () => new Set((plan.data?.drafts ?? []).map((d) => d.createdTicketId).filter((id): id is string => Boolean(id))),
    [plan.data],
  );
  useWorkspaceEvents(
    useCallback(
      (e: WorkspaceEvent) => {
        if (plannerAgentId && (e.type === 'run.started' || e.type === 'run.finished')) {
          if ((e.payload as { agentId?: string } | null)?.agentId !== plannerAgentId) return;
          if (e.type === 'run.started') setLive({ id: e.entityId, running: true, fromStart: true });
          else setLive((cur) => (cur && cur.id === e.entityId ? { ...cur, running: false } : cur));
          return;
        }
        if (e.type === 'ticket.status' && dispatchedTicketIds.has(e.entityId)) {
          qc.invalidateQueries({ queryKey: qk.plan(ws, planId) });
        }
      },
      [plannerAgentId, dispatchedTicketIds, qc, ws, planId],
    ),
  );

  // The planner turns to summarise: the runs behind its own outbound messages.
  const messageRuns = useMemo(
    () => [...new Set((messages.data ?? []).filter((m) => m.direction === 'outbound' && m.runId).map((m) => m.runId!))],
    [messages.data],
  );
  const traces = useRunTraces({ ids: messageRuns, agent: plannerAgentId });
  const rows = useMemo(
    () => chatRows(chatEntries(messages.data ?? [], [], []).entries, traces.data ?? [], { showSilent: false }),
    [messages.data, traces.data],
  );
  const rowRuns = useMemo(() => new Set((messages.data ?? []).map((m) => m.runId).filter((id): id is string => Boolean(id))), [messages.data]);
  useLiveRunSettle(live, setLive, rowRuns);
  const revealIds = useNewOutboundMessageIds(messages.data, threadId);
  const plannerModels = useRuntimeModels(plannerRuntimeId, ws);
  const runtimes = useRuntimes();
  const compactionAt = (runtimes.data ?? []).find((r) => r.id === plannerRuntimeId)?.capabilities['contextCompactionAt'] as number | undefined;
  const resolveContext = useCallback(
    (t: RunTrace): { contextWindowTokens?: number | null; compactionAt?: number | null } => ({
      contextWindowTokens: resolveModel(plannerModels.data, t.model)?.contextWindowTokens,
      compactionAt,
    }),
    [plannerModels.data, compactionAt],
  );

  const drafts = plan.data?.drafts ?? [];
  const canSubmit = drafts.length > 0 && plan.data?.plan.status === 'drafting' && !submit.isPending;
  const plannerRunning = live?.running ?? false;
  const projectName = (id: string | null): string | null => (id ? projectLabel(projects.find((p) => p.id === id) ?? { slug: id, name: id }) : null);
  const openTicket = (identifier: string): void => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } });

  const send = (body: string, files: File[], opts: { idempotencyKey: string }): Promise<void> => {
    if (!plan.data) return Promise.reject(new Error('The planning conversation is still starting.'));
    return post
      .mutateAsync({ threadId: plan.data.plan.threadId, body, projectId, files, idempotencyKey: opts.idempotencyKey })
      .then(() => { setText(''); conversationRef.current?.toBottom(); });
  };

  const move = (draftId: string, position: number): void => {
    if (!plan.data) return;
    patchDraft.mutate({ projectId, planId: plan.data.plan.id, draftId, patch: { position } });
  };

  const setTier = (draftId: string, current: string, tier: (typeof TIERS)[number], suggested: string): void => {
    if (!plan.data) return;
    if (current === tier) return;
    patchDraft.mutate({ projectId, planId: plan.data.plan.id, draftId, patch: { tierOverride: tier === suggested ? null : tier } });
  };

  const beginEdit = (d: PlanDraft): void => {
    setEditingId(d.id);
    setEditTitle(d.title);
    setEditDescription(d.description);
    setEditKind(d.kind);
    setEditPriority(d.priority);
    setEditTargetRoleId(d.targetRoleId ?? '');
  };
  const cancelEdit = (): void => setEditingId(null);
  const saveEdit = (draftId: string): void => {
    const title = editTitle.trim();
    if (!title || !plan.data) return;
    patchDraft.mutate(
      {
        projectId,
        planId: plan.data.plan.id,
        draftId,
        patch: { title, description: editDescription, kind: editKind, priority: editPriority, targetRoleId: editTargetRoleId || null },
      },
      { onSuccess: () => setEditingId(null) },
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-plan-tab>
      <div className="flex flex-none border-b border-line-1 md:hidden">
        <button type="button" onClick={() => setPhoneTab('chat')} aria-pressed={phoneTab === 'chat'} className={cx('flex-1 py-2 text-micro', phoneTab === 'chat' ? 'text-text-1' : 'text-text-3')}>
          Chat
        </button>
        <button type="button" onClick={() => setPhoneTab('drafts')} aria-pressed={phoneTab === 'drafts'} className={cx('flex-1 py-2 text-micro', phoneTab === 'drafts' ? 'text-text-1' : 'text-text-3')}>
          Drafts ({drafts.length})
        </button>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <section className={cx('flex min-h-0 min-w-0 flex-1 flex-col md:border-r md:border-line-1', phoneTab === 'drafts' && 'hidden md:flex')} aria-label="Conversation with the planner">
          <ChatConversation
            ref={conversationRef}
            ws={ws}
            rows={rows}
            loading={
              !plan.data
                ? <p className="text-micro text-text-3">Starting the planning conversation…</p>
                : messages.data === undefined && !messages.isError
                  ? <p className="text-micro text-text-4">Loading the conversation…</p>
                  : null
            }
            error={messages.isError ? <p className="text-micro text-text-3">Could not load the planning conversation.</p> : null}
            empty={<p className="text-micro text-text-3">Tell the planner what you want to build.</p>}
            actorName="Planner"
            workingAriaLabel="Planner is working"
            runtimeId={plannerRuntimeId}
            live={live}
            working={plannerRunning}
            focused={focused}
            revealIds={revealIds}
            onTicket={openTicket}
            projectName={projectName}
            resolveContext={resolveContext}
            ready={messages.data !== undefined}
          />
          <div className="flex-none border-t border-line-1 p-2.5">
            <div className="mx-auto w-full max-w-[720px]">
              <ChatComposer
                projects={projects}
                projectId={projectId}
                onChangeProject={() => undefined}
                value={text}
                onChange={setText}
                onSubmit={send}
                showScope={false}
                placeholder="Talk through the plan…"
                ariaLabel="Message the planner"
                disabled={!plan.data}
                sharedDictation={false}
                focused={focused}
                queuedReason={
                  conn.state === 'offline' || conn.state === 'unreachable'
                    ? 'Offline — your message is queued'
                    : plannerRunning
                      ? 'Planner is replying — your message is queued'
                      : null
                }
              />
            </div>
          </div>
        </section>

        <aside className={cx('flex min-h-0 min-w-0 flex-col md:w-[380px] md:flex-none', phoneTab === 'chat' && 'hidden md:flex')} aria-label="Draft tickets">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {drafts.length === 0 ? (
              <p className="text-micro text-text-3">No drafts yet — the planner adds them here as you talk.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {drafts.map((d, i) => {
                  const effectiveTier = d.tierOverride ?? d.suggestedTier;
                  const editing = editingId === d.id;
                  return (
                    <li key={d.id} className="rounded-r4 border border-line-2 bg-bg-2 p-2.5">
                      {editing ? (
                        <div className="flex flex-col gap-1.5">
                          <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            aria-label={`Title of ${d.title}`}
                            className="h-8 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1 outline-none"
                          />
                          <textarea
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            aria-label={`Description of ${d.title}`}
                            rows={2}
                            className="resize-none rounded-r4 border border-line-2 bg-bg-input px-2 py-1 text-micro text-text-1 outline-none"
                          />
                          <div className="flex flex-wrap items-center gap-1.5">
                            <select
                              value={editKind}
                              onChange={(e) => setEditKind(e.target.value as PlanDraftKind)}
                              aria-label={`Kind of ${d.title}`}
                              className="h-7 rounded-r4 border border-line-2 bg-bg-input px-1 text-nano text-text-2 outline-none"
                            >
                              {PLAN_DRAFT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                            <select
                              value={editPriority}
                              onChange={(e) => setEditPriority(e.target.value as TicketPriority)}
                              aria-label={`Priority of ${d.title}`}
                              className="h-7 rounded-r4 border border-line-2 bg-bg-input px-1 text-nano text-text-2 outline-none"
                            >
                              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <select
                              value={editTargetRoleId}
                              onChange={(e) => setEditTargetRoleId(e.target.value)}
                              aria-label={`Target role of ${d.title}`}
                              className="h-7 rounded-r4 border border-line-2 bg-bg-input px-1 text-nano text-text-2 outline-none"
                            >
                              <option value="">Unassigned</option>
                              {(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button type="button" disabled={!editTitle.trim() || patchDraft.isPending} onClick={() => saveEdit(d.id)} className="v2-tag text-nano">
                              Save
                            </button>
                            <button type="button" onClick={cancelEdit} className="v2-tag text-nano text-text-3">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5">
                            <span className="v2-tag text-nano">{d.kind}</span>
                            <span className="v2-tag text-nano">{d.priority}</span>
                            <div className="ml-auto flex items-center gap-1">
                              {d.status === 'pending' ? (
                                <>
                                  <button type="button" aria-label={`Move ${d.title} up`} disabled={i === 0} onClick={() => move(d.id, i - 1)} className="text-text-4 hover:text-text-1 disabled:opacity-30">
                                    ↑
                                  </button>
                                  <button type="button" aria-label={`Move ${d.title} down`} disabled={i === drafts.length - 1} onClick={() => move(d.id, i + 1)} className="text-text-4 hover:text-text-1 disabled:opacity-30">
                                    ↓
                                  </button>
                                  <button type="button" aria-label={`Edit ${d.title}`} onClick={() => beginEdit(d)} className="text-text-4 hover:text-text-1">
                                    Edit
                                  </button>
                                  {d.kind === 'scout' && plan.data?.plan.status === 'drafting' ? (
                                    <button
                                      type="button"
                                      aria-label={`Dispatch ${d.title}`}
                                      disabled={dispatchDraft.isPending}
                                      onClick={() => plan.data && dispatchDraft.mutate({ projectId, planId: plan.data.plan.id, draftId: d.id })}
                                      className="text-nano text-text-2 hover:text-text-1"
                                    >
                                      Dispatch
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    aria-label={`Remove ${d.title}`}
                                    onClick={() => plan.data && removeDraft.mutate({ projectId, planId: plan.data.plan.id, draftId: d.id })}
                                    className="text-text-4 hover:text-text-1"
                                  >
                                    ×
                                  </button>
                                </>
                              ) : (
                                <span className="text-nano text-text-3">
                                  {d.status === 'failed'
                                    ? `Failed${d.failureReason ? `: ${d.failureReason}` : ''}`
                                    : d.ticketStatus && ['done', 'cancelled'].includes(d.ticketStatus)
                                      ? 'Reported'
                                      : 'Dispatched — running'}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="mt-1 text-micro text-text-1">{d.title}</p>
                          {d.description ? <p className="mt-0.5 whitespace-pre-wrap text-nano text-text-3">{d.description}</p> : null}
                          {d.targetRoleId ? <p className="mt-0.5 text-nano text-text-4">Role: {roles.data?.find((r) => r.id === d.targetRoleId)?.name ?? d.targetRoleId}</p> : null}
                          {d.blockedBy.length > 0 ? <p className="mt-0.5 text-nano text-text-4">Depends on {d.blockedBy.length} draft{d.blockedBy.length > 1 ? 's' : ''}</p> : null}
                          {d.status === 'pending' ? (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              <span className="text-nano text-text-4">Tier ({d.suggestedTier} suggested):</span>
                              {TIERS.map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  aria-pressed={effectiveTier === t}
                                  onClick={() => setTier(d.id, effectiveTier, t, d.suggestedTier)}
                                  className={cx('v2-tag text-nano', effectiveTier === t ? 'bg-bg-3 text-text-1' : 'text-text-3')}
                                >
                                  {t}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex flex-none items-center gap-2 border-t border-line-1 p-2.5">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => plan.data && submit.mutate({ projectId, planId: plan.data.plan.id }, { onSuccess: () => onSubmitted(plan.data!.plan.id) })}
              className="v2-tag ml-auto border-accent bg-accent px-3 py-1.5 text-bg-0 disabled:opacity-50"
            >
              Submit
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
