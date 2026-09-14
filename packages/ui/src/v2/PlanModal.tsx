/**
 * The V2 Plan modal (VS-398): a captain-authored draft plan, drafted interactively with a read-only
 * planning agent. Desktop: a centered dialog with the chat and the draft list side by side. Phone: a
 * full-screen sheet, the two panes switched by a tab (no room to show both at once). Opening always
 * resumes the project's one `drafting` plan, or starts a fresh one — never a second one.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlanDraft, PlanDraftKind, Project, TicketPriority, WorkspaceEvent } from '@weave-ai/shared';
import { PLAN_DRAFT_KINDS, TICKET_PRIORITIES, projectLabel } from '@weave-ai/shared';
import {
  useStartOrResumePlan, usePlan, usePatchPlanDraft, useRemovePlanDraft, useSubmitPlan, useDiscardPlan,
  useThreadMessages, usePostThreadMessage, useRoles,
} from '../api/hooks';
import { useConnection, useWorkspaceEvents, useWs } from '../api/context';
import { qk } from '../api/keys';
import { cx } from '../lib/cx';
import { ChatComposer } from './ChatComposer';
import { AttachmentRows } from './ChatMessage';

const TIERS = ['quick', 'standard', 'deep'] as const;

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
  const [planId, setPlanId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editKind, setEditKind] = useState<PlanDraftKind>('change');
  const [editPriority, setEditPriority] = useState<TicketPriority>('medium');
  const [editTargetRoleId, setEditTargetRoleId] = useState('');

  const effectiveProjectId = scopedProjectId ?? projects[0]?.id ?? null;
  const start = useStartOrResumePlan();
  const ws = useWs();
  const conn = useConnection();
  const qc = useQueryClient();
  const [plannerRunning, setPlannerRunning] = useState(false);

  // Opening the modal (or switching its project) always resumes the one drafting plan for that
  // project, or starts a fresh one — never waits for a manual "start" action.
  useEffect(() => {
    if (!open || !effectiveProjectId) return;
    setPlanId(null);
    setPhoneTab('chat');
    start.mutate({ projectId: effectiveProjectId }, { onSuccess: (r) => setPlanId(r.plan.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only when the modal opens or the project changes, not on every render
  }, [open, effectiveProjectId]);

  const plan = usePlan(effectiveProjectId, planId);
  const roles = useRoles(effectiveProjectId ?? undefined);
  const messages = useThreadMessages(plan.data?.plan.threadId ?? null);
  const post = usePostThreadMessage();
  const patchDraft = usePatchPlanDraft();
  const removeDraft = useRemovePlanDraft();
  const submit = useSubmitPlan();
  const discard = useDiscardPlan();

  // Draft edits and replies can arrive from the planner between our own fetches; re-fetch the plan
  // whenever a `plan.*` event names it, the same way ChatPage reacts to `run.*` events. The planner's
  // own run is tracked too, so the composer can report a sent message as queued while it replies.
  const plannerAgentId = plan.data?.plan.agentId ?? null;
  useWorkspaceEvents(
    useCallback(
      (e: WorkspaceEvent) => {
        if (plannerAgentId && (e.type === 'run.started' || e.type === 'run.finished')) {
          if ((e.payload as { agentId?: string } | null)?.agentId !== plannerAgentId) return;
          setPlannerRunning(e.type === 'run.started');
          return;
        }
        if (!planId || !e.type.startsWith('plan.')) return;
        const eventPlanId = e.entityType === 'plan' ? e.entityId : (e.payload as { planId?: string } | undefined)?.planId;
        if (eventPlanId !== planId) return;
        qc.invalidateQueries({ queryKey: qk.plan(ws, planId) });
      },
      [planId, ws, qc, plannerAgentId],
    ),
  );

  if (!open) return null;

  const drafts = plan.data?.drafts ?? [];
  const canSubmit = drafts.length > 0 && plan.data?.plan.status === 'drafting' && !submit.isPending;

  const send = (body: string, files: File[], opts: { idempotencyKey: string }): Promise<void> => {
    if (!plan.data || !effectiveProjectId) return Promise.reject(new Error('The planning conversation is still starting.'));
    return post
      .mutateAsync({ threadId: plan.data.plan.threadId, body, projectId: effectiveProjectId, files, idempotencyKey: opts.idempotencyKey })
      .then(() => { setText(''); });
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

        <div className="flex flex-none border-b border-line-1 md:hidden">
          <button type="button" onClick={() => setPhoneTab('chat')} aria-pressed={phoneTab === 'chat'} className={cx('flex-1 py-2 text-micro', phoneTab === 'chat' ? 'text-text-1' : 'text-text-3')}>
            Chat
          </button>
          <button type="button" onClick={() => setPhoneTab('drafts')} aria-pressed={phoneTab === 'drafts'} className={cx('flex-1 py-2 text-micro', phoneTab === 'drafts' ? 'text-text-1' : 'text-text-3')}>
            Drafts ({drafts.length})
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <section className={cx('flex min-h-0 flex-1 flex-col md:border-r md:border-line-1', phoneTab === 'drafts' && 'hidden md:flex')} aria-label="Conversation with the planner">
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!plan.data ? (
                <p className="text-micro text-text-3">Starting the planning conversation…</p>
              ) : !messages.data || messages.data.length === 0 ? (
                <p className="text-micro text-text-3">Tell the planner what you want to build.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {messages.data.map((m) => (
                    <li
                      key={m.id}
                      className={cx(
                        'max-w-[85%] rounded-r4 border px-3 py-2 text-micro text-text-1',
                        m.direction === 'inbound' ? 'self-end border-line-2 bg-bg-2' : 'border-line-1 bg-bg-0',
                      )}
                    >
                      {m.body ? <p className="whitespace-pre-wrap">{m.body}</p> : null}
                      <AttachmentRows ws={ws} threadId={m.threadId} parts={m.parts} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
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

          <aside className={cx('flex min-h-0 flex-1 flex-col md:max-w-[380px]', phoneTab === 'chat' && 'hidden md:flex')} aria-label="Draft tickets">
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
                                <button type="button" aria-label={`Move ${d.title} up`} disabled={i === 0} onClick={() => move(d.id, i - 1)} className="text-text-4 hover:text-text-1 disabled:opacity-30">
                                  ↑
                                </button>
                                <button type="button" aria-label={`Move ${d.title} down`} disabled={i === drafts.length - 1} onClick={() => move(d.id, i + 1)} className="text-text-4 hover:text-text-1 disabled:opacity-30">
                                  ↓
                                </button>
                                <button type="button" aria-label={`Edit ${d.title}`} onClick={() => beginEdit(d)} className="text-text-4 hover:text-text-1">
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Remove ${d.title}`}
                                  onClick={() => effectiveProjectId && plan.data && removeDraft.mutate({ projectId: effectiveProjectId, planId: plan.data.plan.id, draftId: d.id })}
                                  className="text-text-4 hover:text-text-1"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                            <p className="mt-1 text-micro text-text-1">{d.title}</p>
                            {d.description ? <p className="mt-0.5 whitespace-pre-wrap text-nano text-text-3">{d.description}</p> : null}
                            {d.targetRoleId ? <p className="mt-0.5 text-nano text-text-4">Role: {roles.data?.find((r) => r.id === d.targetRoleId)?.name ?? d.targetRoleId}</p> : null}
                            {d.blockedBy.length > 0 ? <p className="mt-0.5 text-nano text-text-4">Depends on {d.blockedBy.length} draft{d.blockedBy.length > 1 ? 's' : ''}</p> : null}
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
                onClick={() => effectiveProjectId && plan.data && discard.mutate({ projectId: effectiveProjectId, planId: plan.data.plan.id }, { onSuccess: onClose })}
                className="v2-tag text-text-3 hover:text-text-1"
              >
                Discard
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => effectiveProjectId && plan.data && submit.mutate({ projectId: effectiveProjectId, planId: plan.data.plan.id }, { onSuccess: onClose })}
                className="v2-tag ml-auto border-accent bg-accent px-3 py-1.5 text-bg-0 disabled:opacity-50"
              >
                Submit
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
