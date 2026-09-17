/**
 * The V2 Plan modal (VS-398, tabbed in VS-477): a captain-authored draft plan, drafted interactively
 * with a read-only planning agent. Desktop: a centered dialog with the chat and the draft list side
 * by side. Phone: a full-screen sheet, the two panes switched by a tab (no room to show both at once).
 *
 * A project may hold several drafting plans at once, shown as one tab per plan (VS-477). Tabs are
 * server state — the list is fetched and each tab's plan is loaded on focus — while the last-focused
 * tab is remembered on the device. A **New plan** control starts a fresh plan; a tab's delete control
 * discards it after a confirm, leaving the others; an untitled tab reads **New plan** until the planner
 * (or captain, by double-clicking the tab) names it.
 *
 * The planner chat is the weaver chat (VS-442): its conversation renders through the shared
 * `ChatConversation` view, so markdown messages, the per-turn "Planner did …" summary and the live
 * working trace are the same code as Chat's. Only the weaver-only extras — inline decision cards,
 * dispatch chips, the reply control and the unattributed-worker row — are omitted here; the planner
 * files no tickets and raises no decisions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlanDraft, PlanDraftKind, PlanSummary, Project, RunTrace, TicketPriority, WorkspaceEvent } from '@weave-ai/shared';
import { PLAN_DRAFT_KINDS, TICKET_PRIORITIES, projectLabel } from '@weave-ai/shared';
import { resolveModel } from '@weave-ai/render';
import {
  usePlans, useCreatePlan, useActivatePlan, useRenamePlan,
  usePlan, usePatchPlanDraft, useRemovePlanDraft, useDispatchPlanDraft, useSubmitPlan, useDiscardPlan,
  useThreadMessages, usePostThreadMessage, useRoles, useRunTraces, useRuntimes, useRuntimeModels,
} from '../api/hooks';
import { useConnection, useWorkspaceEvents, useWs } from '../api/context';
import { qk } from '../api/keys';
import { useGo } from '../app/link';
import { cx } from '../lib/cx';
import { chatEntries, chatRows } from '../lib/dispatch';
import { useNewOutboundMessageIds } from '../lib/streamReveal';
import { ChatComposer } from './ChatComposer';
import { ChatConversation, useLiveRunSettle } from './ChatConversation';
import type { ChatConversationHandle, LiveChatRun } from './ChatConversation';

const TIERS = ['quick', 'standard', 'deep'] as const;

/** The device-remembered last-focused tab, one per project. Server state keeps the tabs; this keeps the focus. */
function lastTabKey(ws: string, projectId: string): string { return `weave:plan:lastTab:${ws}:${projectId}`; }
function readLastTab(ws: string, projectId: string | null): string | null {
  if (!projectId || typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(lastTabKey(ws, projectId)); } catch { return null; }
}
function writeLastTab(ws: string, projectId: string | null, planId: string): void {
  if (!projectId || typeof localStorage === 'undefined') return;
  try { localStorage.setItem(lastTabKey(ws, projectId), planId); } catch { /* private mode: the tab choice is a convenience, never required */ }
}

export interface PlanModalProps {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  projectId: string | null;
}

export function PlanModal({ open, onClose, projects, projectId }: PlanModalProps): React.ReactElement | null {
  const [scopedProjectId, setScopedProjectId] = useState<string | null>(projectId);
  const [phoneTab, setPhoneTab] = useState<'chat' | 'drafts'>('chat');
  const [text, setText] = useState('');
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  // The planner's own runtime, so its turns' summary can resolve the model's context window (VS-442);
  // `/activate` returns it alongside the agent's id.
  const [plannerRuntimeId, setPlannerRuntimeId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editKind, setEditKind] = useState<PlanDraftKind>('change');
  const [editPriority, setEditPriority] = useState<TicketPriority>('medium');
  const [editTargetRoleId, setEditTargetRoleId] = useState('');

  const effectiveProjectId = scopedProjectId ?? projects[0]?.id ?? null;
  const ws = useWs();
  const conn = useConnection();
  const go = useGo();
  const qc = useQueryClient();
  // The planner's live turn, tracked exactly as ChatPage tracks the weaver's: `fromStart` is true
  // only for a run this modal saw begin, so its first line streams (VS-440).
  const [live, setLive] = useState<LiveChatRun | null>(null);
  // Sending returns the planner conversation to the bottom and resumes following, exactly as the
  // weaver chat does (VS-451), through the shared view's handle (VS-442).
  const conversationRef = useRef<ChatConversationHandle>(null);

  const plans = usePlans(effectiveProjectId);
  const tabs = useMemo(() => plans.data?.plans ?? [], [plans.data]);
  const create = useCreatePlan();
  const activate = useActivatePlan();
  const rename = useRenamePlan();

  // Opening the modal, or switching its project, clears the focused plan, the remembered planner
  // runtime and any in-progress tab interaction; the list below then picks the tab to focus.
  useEffect(() => {
    if (!open) return;
    setActivePlanId(null);
    setPlannerRuntimeId(null);
    setLive(null);
    setPhoneTab('chat');
    setRenamingId(null);
    setConfirmDeleteId(null);
  }, [open, effectiveProjectId]);

  // Focus the remembered tab when it is still drafting, otherwise the newest drafting plan. With no
  // drafting plans the modal shows the empty state — it never creates one unasked (VS-477).
  useEffect(() => {
    if (!open) return;
    if (activePlanId && tabs.some((t) => t.id === activePlanId)) return;
    const remembered = readLastTab(ws, effectiveProjectId);
    setActivePlanId(tabs.find((t) => t.id === remembered)?.id ?? tabs[0]?.id ?? null);
  }, [open, tabs, activePlanId, ws, effectiveProjectId]);

  // Focusing a plan ensures its planner is live (resuming a retired one) and retires the project's
  // other planners that have gone idle, so several tabs never hold several live planners.
  useEffect(() => {
    if (!open || !effectiveProjectId || !activePlanId) return;
    activate.mutate({ projectId: effectiveProjectId, planId: activePlanId }, { onSuccess: (r) => setPlannerRuntimeId(r.agent.runtimeId) });
    writeLastTab(ws, effectiveProjectId, activePlanId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on focus change, not on every activate render
  }, [open, effectiveProjectId, activePlanId]);

  const plan = usePlan(effectiveProjectId, activePlanId);
  const roles = useRoles(effectiveProjectId ?? undefined);
  const messages = useThreadMessages(plan.data?.plan.threadId ?? null);
  const post = usePostThreadMessage();
  const patchDraft = usePatchPlanDraft();
  const removeDraft = useRemovePlanDraft();
  const dispatchDraft = useDispatchPlanDraft();
  const submit = useSubmitPlan();
  const discard = useDiscardPlan();
  // VS-517: a dispatched scout's ticket ids, so a `ticket.status` event for one of them (the ticket
  // finishing, or any other status change) refreshes the plan the same way a `plan.*` event does —
  // without this, "reported" would only ever appear after a reload.
  const dispatchedTicketIds = useMemo(
    () => new Set((plan.data?.drafts ?? []).map((d) => d.createdTicketId).filter((id): id is string => Boolean(id))),
    [plan.data],
  );

  // Draft edits, titles and replies can arrive from the planner or another device between our own
  // fetches; re-fetch the tab list and the open plan whenever a `plan.*` event names them, the same
  // way ChatPage reacts to `run.*` events. The planner's own run is tracked too, so the composer can
  // report a sent message as queued while it replies.
  const plannerAgentId = plan.data?.plan.agentId ?? null;
  useWorkspaceEvents(
    useCallback(
      (e: WorkspaceEvent) => {
        if (plannerAgentId && (e.type === 'run.started' || e.type === 'run.finished')) {
          if ((e.payload as { agentId?: string } | null)?.agentId !== plannerAgentId) return;
          if (e.type === 'run.started') setLive({ id: e.entityId, running: true, fromStart: true });
          else setLive((cur) => (cur && cur.id === e.entityId ? { ...cur, running: false } : cur));
          return;
        }
        if (e.type === 'ticket.status' && activePlanId && dispatchedTicketIds.has(e.entityId)) {
          qc.invalidateQueries({ queryKey: qk.plan(ws, activePlanId) });
          return;
        }
        if (!e.type.startsWith('plan.')) return;
        if (effectiveProjectId) qc.invalidateQueries({ queryKey: qk.plans(ws, effectiveProjectId) });
        if (!activePlanId) return;
        const eventPlanId = e.entityType === 'plan' ? e.entityId : (e.payload as { planId?: string } | undefined)?.planId;
        if (eventPlanId !== activePlanId) return;
        qc.invalidateQueries({ queryKey: qk.plan(ws, activePlanId) });
      },
      [effectiveProjectId, activePlanId, ws, qc, plannerAgentId, dispatchedTicketIds],
    ),
  );

  // The planner turns to summarise: the runs behind its own outbound messages. The conversation rows
  // and the reply reveal are the same view models the weaver chat uses.
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
  const revealIds = useNewOutboundMessageIds(messages.data, plan.data?.plan.threadId ?? null);
  const plannerModels = useRuntimeModels(plannerRuntimeId);
  const runtimes = useRuntimes();
  const compactionAt = (runtimes.data ?? []).find((r) => r.id === plannerRuntimeId)?.capabilities['contextCompactionAt'] as number | undefined;
  const resolveContext = useCallback(
    (t: RunTrace): { contextWindowTokens?: number | null; compactionAt?: number | null } => ({
      contextWindowTokens: resolveModel(plannerModels.data, t.model)?.contextWindowTokens,
      compactionAt,
    }),
    [plannerModels.data, compactionAt],
  );

  if (!open) return null;

  const drafts = plan.data?.drafts ?? [];
  const canSubmit = drafts.length > 0 && plan.data?.plan.status === 'drafting' && !submit.isPending;
  const plannerRunning = live?.running ?? false;
  const projectName = (id: string | null): string | null => (id ? projectLabel(projects.find((p) => p.id === id) ?? { slug: id, name: id }) : null);
  const openTicket = (identifier: string): void => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } });
  const tabLabel = (t: PlanSummary): string => t.title?.trim() || 'New plan';
  const confirmPlan = tabs.find((t) => t.id === confirmDeleteId) ?? null;

  const newPlan = (): void => {
    if (!effectiveProjectId) return;
    create.mutate({ projectId: effectiveProjectId }, { onSuccess: (r) => { setActivePlanId(r.plan.id); writeLastTab(ws, effectiveProjectId, r.plan.id); } });
  };

  const startRename = (t: PlanSummary): void => { setRenamingId(t.id); setRenameValue(t.title ?? ''); };
  const saveRename = (t: PlanSummary): void => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title || !effectiveProjectId || title === (t.title ?? '')) return;
    rename.mutate({ projectId: effectiveProjectId, planId: t.id, title });
  };

  /** Discard the confirmed tab; the others stay, and removing the last one leaves the empty state. */
  const deleteConfirmed = (): void => {
    const t = confirmPlan;
    setConfirmDeleteId(null);
    if (!t || !effectiveProjectId) return;
    discard.mutate({ projectId: effectiveProjectId, planId: t.id }, {
      onSuccess: () => { if (activePlanId === t.id) setActivePlanId(null); },
    });
  };

  const afterSubmit = (): void => {
    const submittedId = activePlanId;
    setActivePlanId(null);
    if (submittedId) qc.invalidateQueries({ queryKey: qk.plans(ws, effectiveProjectId ?? '') });
  };

  const send = (body: string, files: File[], opts: { idempotencyKey: string }): Promise<void> => {
    if (!plan.data || !effectiveProjectId) return Promise.reject(new Error('The planning conversation is still starting.'));
    return post
      .mutateAsync({ threadId: plan.data.plan.threadId, body, projectId: effectiveProjectId, files, idempotencyKey: opts.idempotencyKey })
      .then(() => { setText(''); conversationRef.current?.toBottom(); });
  };

  const move = (draftId: string, position: number): void => {
    if (!plan.data || !effectiveProjectId) return;
    patchDraft.mutate({ projectId: effectiveProjectId, planId: plan.data.plan.id, draftId, patch: { position } });
  };

  const setTier = (draftId: string, current: string, tier: (typeof TIERS)[number], suggested: string): void => {
    if (!plan.data || !effectiveProjectId) return;
    if (current === tier) return;
    patchDraft.mutate({ projectId: effectiveProjectId, planId: plan.data.plan.id, draftId, patch: { tierOverride: tier === suggested ? null : tier } });
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
    if (!title || !plan.data || !effectiveProjectId) return;
    patchDraft.mutate(
      {
        projectId: effectiveProjectId,
        planId: plan.data.plan.id,
        draftId,
        patch: { title, description: editDescription, kind: editKind, priority: editPriority, targetRoleId: editTargetRoleId || null },
      },
      { onSuccess: () => setEditingId(null) },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col md:items-center md:justify-center md:p-6" role="dialog" aria-modal="true" aria-label="Plan">
      <button type="button" className="absolute inset-0 hidden md:block" style={{ background: 'var(--overlay)' }} aria-label="Close" onClick={onClose} />
      <div
        className="v2-anim-pop relative flex h-full w-full flex-col overflow-hidden border-line-2 bg-bg-1 md:h-[85vh] md:max-h-[760px] md:w-[960px] md:rounded-r6 md:border"
        style={{ boxShadow: 'var(--elev-sheet)' }}
      >
        <header className="flex flex-none items-center gap-2 border-b border-line-1 px-3.5 py-2.5">
          <span className="text-ui font-medium text-text-1">Plan</span>
          <div className="ml-2 flex flex-wrap gap-1.5">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={p.id === effectiveProjectId}
                onClick={() => setScopedProjectId(p.id)}
                className={cx('v2-tag', p.id === effectiveProjectId ? 'bg-bg-3 text-text-1' : 'text-text-2')}
              >
                {projectLabel(p)}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto flex size-[22px] flex-none items-center justify-center rounded-[3px] text-text-3 hover:bg-bg-2 hover:text-text-1">
            ×
          </button>
        </header>

        <div className="flex min-h-0 flex-none items-center gap-2 border-b border-line-1 px-3 py-1.5">
          {/* The tabs scroll horizontally and never wrap; New plan sits outside the scroller so a long tab strip can never push it off-screen (VS-477). */}
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Plans">
            {tabs.map((t) => {
            const focused = t.id === activePlanId;
            const label = tabLabel(t);
            return (
              <span key={t.id} className={cx('flex flex-none items-center gap-1 rounded-r4 border px-1.5', focused ? 'border-line-2 bg-bg-3' : 'border-transparent')}>
                {renamingId === t.id ? (
                  <>
                    <input
                      value={renameValue}
                      autoFocus
                      aria-label="Plan name"
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(t); if (e.key === 'Escape') setRenamingId(null); }}
                      className="h-7 w-[140px] rounded-r4 border border-line-2 bg-bg-input px-1.5 text-micro text-text-1 outline-none"
                    />
                    <button type="button" aria-label="Save name" onClick={() => saveRename(t)} className="text-nano text-text-2 hover:text-text-1">Save</button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={focused}
                      aria-label={`Plan: ${label}`}
                      onDoubleClick={() => startRename(t)}
                      onClick={() => setActivePlanId(t.id)}
                      className={cx('py-1 text-micro', focused ? 'text-text-1' : 'text-text-3 hover:text-text-2')}
                    >
                      {label}
                    </button>
                    <button type="button" aria-label={`Delete plan ${label}`} onClick={() => setConfirmDeleteId(t.id)} className="text-nano text-text-4 hover:text-text-1">
                      ×
                    </button>
                  </>
                )}
              </span>
            );
          })}
          </div>
          {tabs.length > 0 ? (
            <button
              type="button"
              onClick={newPlan}
              disabled={!effectiveProjectId || create.isPending}
              className="v2-tag flex-none text-text-2 disabled:opacity-50"
            >
              New plan
            </button>
          ) : null}
        </div>

        {confirmPlan ? (
          <div role="alertdialog" aria-label="Delete plan?" className="flex flex-none items-center gap-2 border-b border-line-1 bg-bg-2 px-3.5 py-2 text-micro text-text-2">
            <span>Delete “{tabLabel(confirmPlan)}”? No tickets will be created.</span>
            <button type="button" onClick={deleteConfirmed} className="v2-tag text-text-1">Delete</button>
            <button type="button" onClick={() => setConfirmDeleteId(null)} className="v2-tag text-text-3">Cancel</button>
          </div>
        ) : null}

        {tabs.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-micro text-text-3">No plans yet. Start one to plan a body of work with the planner.</p>
            <button type="button" onClick={newPlan} disabled={!effectiveProjectId || create.isPending} className="v2-tag border-accent bg-accent px-3 py-1.5 text-bg-0 disabled:opacity-50">
              New plan
            </button>
          </div>
        ) : (
          <>
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
                  live={live}
                  working={plannerRunning}
                  revealIds={revealIds}
                  onTicket={openTicket}
                  projectName={projectName}
                  resolveContext={resolveContext}
                  ready={messages.data !== undefined}
                />
                <div className="flex-none border-t border-line-1 p-2.5">
                  <ChatComposer
                    projects={projects}
                    projectId={effectiveProjectId}
                    onChangeProject={() => undefined}
                    value={text}
                    onChange={setText}
                    onSubmit={send}
                    showScope={false}
                    placeholder="Talk through the plan…"
                    ariaLabel="Message the planner"
                    disabled={!plan.data}
                    sharedDictation={false}
                    queuedReason={
                      conn.state === 'offline' || conn.state === 'unreachable'
                        ? 'Offline — your message is queued'
                        : plannerRunning
                          ? 'Planner is replying — your message is queued'
                          : null
                    }
                  />
                </div>
              </section>

              <aside className={cx('flex min-h-0 min-w-0 flex-1 flex-col md:max-w-[380px]', phoneTab === 'chat' && 'hidden md:flex')} aria-label="Draft tickets">
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
                                            onClick={() => effectiveProjectId && plan.data && dispatchDraft.mutate({ projectId: effectiveProjectId, planId: plan.data.plan.id, draftId: d.id })}
                                            className="text-nano text-text-2 hover:text-text-1"
                                          >
                                            Dispatch
                                          </button>
                                        ) : null}
                                        <button
                                          type="button"
                                          aria-label={`Remove ${d.title}`}
                                          onClick={() => effectiveProjectId && plan.data && removeDraft.mutate({ projectId: effectiveProjectId, planId: plan.data.plan.id, draftId: d.id })}
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
                    onClick={() => effectiveProjectId && plan.data && submit.mutate({ projectId: effectiveProjectId, planId: plan.data.plan.id }, { onSuccess: afterSubmit })}
                    className="v2-tag ml-auto border-accent bg-accent px-3 py-1.5 text-bg-0 disabled:opacity-50"
                  >
                    Submit
                  </button>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
