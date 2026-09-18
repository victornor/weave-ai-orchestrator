/**
 * The V2 chat tab strip (VS-556): the weaver conversation is the first tab and every drafting plan
 * in the workspace follows as its own tab, tagged with its project. A **New plan** control at the
 * end starts a fresh plan in the chat's selected project.
 *
 * The set of tabs is server state — each project's `drafting` plans — so it survives a reload with no
 * extra persistence; only which tab is focused is remembered, on the device, per workspace. Focusing
 * a plan tab ensures its planner is live and retires the project's other idle planners, exactly as
 * the Plan modal did (VS-477), and any `plan.*` event refreshes the strip.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlanSummary, Project, WorkspaceEvent } from '@weave-ai/shared';
import { projectLabel } from '@weave-ai/shared';
import {
  useActivatePlan,
  useCreatePlan,
  useDiscardPlan,
  usePlansMany,
  useRenamePlan,
} from '../api/hooks';
import { qk } from '../api/keys';
import { useWorkspaceEvents, useWs } from '../api/context';
import { cx } from '../lib/cx';
import { projectColorVar } from '../lib/projectColor';

/** Which chat tab is focused: the weaver conversation, or one plan. `projectId` is known for a plan. */
export type ChatTabFocus = { kind: 'weaver' } | { kind: 'plan'; planId: string; projectId: string };

/** The device-remembered focus value standing for the weaver tab. */
const WEAVER = 'weaver';
function focusKey(ws: string): string { return `weave:plan:lastTab:${ws}`; }
function readFocus(ws: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(focusKey(ws)); } catch { return null; }
}
function writeFocus(ws: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(focusKey(ws), value); } catch { /* private mode: focus is a convenience */ }
}

export interface PlanTabsValue {
  /** Every drafting plan in the workspace, grouped by project in the workspace's project order. */
  tabs: PlanSummary[];
  /** The resolved focus: a plan that is still a drafting plan, else the weaver tab. */
  focused: ChatTabFocus;
  /** The focused planner's runtime, so a turn summary can resolve its model's context window (VS-442). */
  plannerRuntimeId: string | null;
  isCreating: boolean;
  focusWeaver: () => void;
  focusPlan: (planId: string, projectId: string) => void;
  createPlan: (projectId: string) => void;
  renamePlan: (projectId: string, planId: string, title: string) => void;
  discardPlan: (projectId: string, planId: string) => void;
  /** A plan left the drafting list (submitted or discarded): fall the focus back if it held it. */
  onPlanGone: (planId: string) => void;
}

export function usePlanTabs({ projects }: { projects: Project[] }): PlanTabsValue {
  const ws = useWs();
  const qc = useQueryClient();
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const { plans } = usePlansMany(projectIds);
  const create = useCreatePlan();
  const activate = useActivatePlan();
  const rename = useRenamePlan();
  const discard = useDiscardPlan();

  const [focus, setFocus] = useState<ChatTabFocus>(() => {
    const remembered = readFocus(ws);
    return remembered && remembered !== WEAVER ? { kind: 'plan', planId: remembered, projectId: '' } as ChatTabFocus : { kind: 'weaver' };
  });
  const [plannerRuntimeId, setPlannerRuntimeId] = useState<string | null>(null);
  // A just-created plan, shown as a tab before the list refetch lands (the create response has the
  // plan; the strip's own query catches up a tick later).
  const [optimistic, setOptimistic] = useState<PlanSummary | null>(null);

  const tabs = useMemo(
    () => (optimistic && !plans.some((p) => p.id === optimistic.id) ? [...plans, optimistic] : plans),
    [plans, optimistic],
  );

  // A remembered plan that is no longer a drafting plan falls back to the weaver tab; one just
  // created carries its project so its tab resolves before the list refetch lands.
  const focused = useMemo<ChatTabFocus>(() => {
    if (focus.kind !== 'plan') return { kind: 'weaver' };
    const tab = tabs.find((p) => p.id === focus.planId);
    const projectId = focus.projectId || tab?.projectId || null;
    return projectId ? { kind: 'plan', planId: focus.planId, projectId } : { kind: 'weaver' };
  }, [focus, tabs]);

  // Persist the focused tab on the device, per workspace.
  useEffect(() => { writeFocus(ws, focus.kind === 'plan' ? focus.planId : WEAVER); }, [ws, focus]);

  const focusedPlanId = focused.kind === 'plan' ? focused.planId : null;
  const focusedProjectId = focused.kind === 'plan' ? focused.projectId : null;

  // Focusing a plan ensures its planner is live (resuming a retired one) and retires the project's
  // other idle planners, so several tabs never hold several live planners.
  useEffect(() => {
    if (!focusedPlanId || !focusedProjectId) { setPlannerRuntimeId(null); return; }
    activate.mutate(
      { projectId: focusedProjectId, planId: focusedPlanId },
      { onSuccess: (r) => setPlannerRuntimeId(r.agent.runtimeId) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on focus change, not on every mutate render
  }, [focusedPlanId, focusedProjectId]);

  // A plan edit or a dispatched scout's ticket anywhere refreshes the strip without a reload.
  useWorkspaceEvents(
    useCallback(
      (e: WorkspaceEvent) => {
        if (!e.type.startsWith('plan.')) return;
        qc.invalidateQueries({ queryKey: qk.planRoot(ws) });
      },
      [qc, ws],
    ),
  );

  const focusWeaver = useCallback((): void => setFocus({ kind: 'weaver' }), []);
  const focusPlan = useCallback((planId: string, projectId: string): void => setFocus({ kind: 'plan', planId, projectId }), []);

  const createPlan = useCallback(
    (projectId: string) => {
      create.mutate(
        { projectId },
        {
          onSuccess: (r) => {
            setOptimistic({
              id: r.plan.id,
              projectId: r.plan.projectId ?? projectId,
              title: r.plan.title ?? null,
              titleSource: r.plan.titleSource ?? 'auto',
              status: r.plan.status ?? 'drafting',
              draftCount: 0,
              createdAt: r.plan.createdAt ?? new Date().toISOString(),
              updatedAt: r.plan.updatedAt ?? new Date().toISOString(),
            });
            setFocus({ kind: 'plan', planId: r.plan.id, projectId: r.plan.projectId ?? projectId });
          },
        },
      );
    },
    [create],
  );

  const renamePlan = useCallback(
    (projectId: string, planId: string, title: string) => rename.mutate({ projectId, planId, title }),
    [rename],
  );

  const onPlanGone = useCallback(
    (removedId: string) => {
      setOptimistic((cur) => (cur?.id === removedId ? null : cur));
      setFocus((cur) => {
        if (!(cur.kind === 'plan' && cur.planId === removedId)) return cur;
        const next = tabs.find((t) => t.id !== removedId) ?? null;
        return next ? { kind: 'plan', planId: next.id, projectId: next.projectId } : { kind: 'weaver' };
      });
    },
    [tabs],
  );

  const discardPlan = useCallback(
    (projectId: string, planId: string) => discard.mutate({ projectId, planId }, { onSuccess: () => onPlanGone(planId) }),
    [discard, onPlanGone],
  );

  return {
    tabs,
    focused,
    plannerRuntimeId,
    isCreating: create.isPending,
    focusWeaver,
    focusPlan,
    createPlan,
    renamePlan,
    discardPlan,
    onPlanGone,
  };
}

export interface PlanTabStripProps {
  projects: Project[];
  tabs: PlanSummary[];
  focused: ChatTabFocus;
  busy: boolean;
  onFocusWeaver: () => void;
  onFocusPlan: (planId: string, projectId: string) => void;
  onNewPlan: () => void;
  onRename: (projectId: string, planId: string, title: string) => void;
  onDiscard: (projectId: string, planId: string) => void;
}

/**
 * The strip itself: the weaver tab, one tab per drafting plan tagged with its project, and the
 * pinned **New plan** control. It scrolls horizontally and never wraps, and **New plan** sits outside
 * the scroller so a long strip can never push it off-screen (VS-477's rule, kept at chat level).
 */
export function PlanTabStrip({
  projects,
  tabs,
  focused,
  busy,
  onFocusWeaver,
  onFocusPlan,
  onNewPlan,
  onRename,
  onDiscard,
}: PlanTabStripProps): React.ReactElement {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const label = (t: PlanSummary): string => t.title?.trim() || 'New plan';
  const projectName = (id: string): string => projectLabel(projects.find((p) => p.id === id) ?? { slug: id, name: id });
  const projectIds = projects.map((p) => p.id);
  const confirmPlan = tabs.find((t) => t.id === confirmId) ?? null;

  // One tab shape for the weaver and every plan: same height, padding and type. The active tab is
  // marked by an accent underline (visible in both themes) over the strip's own hairline.
  const TAB = 'flex h-[38px] flex-none items-center gap-2 border-b-2 -mb-px px-3 text-micro';
  const TAB_ON = 'border-accent text-text-1';
  const TAB_OFF = 'border-transparent text-text-3 hover:text-text-2';

  const startRename = (t: PlanSummary): void => { setRenamingId(t.id); setRenameValue(t.title ?? ''); };
  const saveRename = (t: PlanSummary): void => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title || title === (t.title ?? '')) return;
    onRename(t.projectId, t.id, title);
  };

  return (
    <div className="flex flex-none flex-col bg-bg-0">
      <div className="flex flex-none items-stretch border-b border-line-1">
        <div role="tablist" aria-label="Chats" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          <button
            type="button"
            role="tab"
            aria-selected={focused.kind === 'weaver'}
            aria-label="Weaver chat"
            onClick={onFocusWeaver}
            className={cx(TAB, focused.kind === 'weaver' ? TAB_ON : TAB_OFF)}
          >
            Weaver
          </button>
          {tabs.map((t) => {
            const selected = focused.kind === 'plan' && focused.planId === t.id;
            const name = label(t);
            return (
              <span key={t.id} className={cx('flex flex-none items-stretch border-b-2 -mb-px', selected ? 'border-accent' : 'border-transparent')}>
                {renamingId === t.id ? (
                  <span className="flex h-[38px] items-center gap-1.5 pl-3 pr-2">
                    <input
                      value={renameValue}
                      autoFocus
                      aria-label="Plan name"
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(t); if (e.key === 'Escape') setRenamingId(null); }}
                      className="h-7 w-[140px] rounded-r4 border border-line-2 bg-bg-input px-1.5 text-micro text-text-1 outline-none"
                    />
                    <button type="button" aria-label="Save name" onClick={() => saveRename(t)} className="text-nano text-text-2 hover:text-text-1">Save</button>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-label={`Plan: ${name}`}
                      onDoubleClick={() => startRename(t)}
                      onClick={() => onFocusPlan(t.id, t.projectId)}
                      className={cx('flex h-[38px] min-w-0 items-center gap-2 pl-3 pr-1 text-micro', selected ? 'text-text-1' : 'text-text-3 hover:text-text-2')}
                    >
                      <span className="max-w-[160px] truncate">{name}</span>
                      <span className="flex flex-none items-center gap-1 text-nano text-text-4" data-plan-project>
                        <span className="size-1.5 flex-none rounded-pill" style={{ background: projectColorVar(t.projectId, projectIds) }} aria-hidden />
                        {projectName(t.projectId)}
                      </span>
                    </button>
                    <button type="button" aria-label={`Discard plan ${name}`} onClick={() => setConfirmId(t.id)} className="flex h-[38px] flex-none items-center pl-1 pr-2.5 text-nano text-text-4 hover:text-text-1">
                      ×
                    </button>
                  </>
                )}
              </span>
            );
          })}
        </div>
        <div className="flex flex-none items-center px-3">
          <button
            type="button"
            onClick={onNewPlan}
            disabled={busy}
            className="v2-tag flex-none border-accent bg-accent text-bg-0 disabled:opacity-50"
          >
            New plan
          </button>
        </div>
      </div>

      {confirmPlan ? (
        <div role="alertdialog" aria-label="Discard this plan?" className="flex flex-none items-center gap-2 border-b border-line-1 bg-bg-2 px-3.5 py-2 text-micro text-text-2">
          <span>Discard this plan? “{label(confirmPlan)}” stays as history and no tickets are created.</span>
          <button type="button" onClick={() => { onDiscard(confirmPlan.projectId, confirmPlan.id); setConfirmId(null); }} className="v2-tag text-text-1">Discard</button>
          <button type="button" onClick={() => setConfirmId(null)} className="v2-tag text-text-3">Cancel</button>
        </div>
      ) : null}
    </div>
  );
}
