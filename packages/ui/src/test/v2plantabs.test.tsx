/**
 * The V2 chat tab strip (VS-556): the weaver conversation as the first tab, one tab per drafting
 * plan in the workspace tagged with its project, New plan created in the chat's selected project,
 * and the focused tab remembered per workspace. The hook and strip are exercised together through a
 * small harness; `../api/hooks` is mocked directly, the established V2 pattern.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanSummary, Project, WorkspaceEvent } from '@weave-ai/shared';
import { project } from './factories';

const state = vi.hoisted(() => ({
  plans: [] as PlanSummary[],
  createResult: null as { id: string; projectId: string } | null,
  created: [] as Array<Record<string, unknown>>,
  activated: [] as Array<Record<string, unknown>>,
  renamed: [] as Array<Record<string, unknown>>,
  discarded: [] as Array<Record<string, unknown>>,
  invalidated: [] as unknown[][],
  onEvent: null as ((e: WorkspaceEvent) => void) | null,
}));

function plan(over: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: 'plan_1', projectId: 'p1', title: 'Redesign the settings page', titleSource: 'human',
    status: 'drafting', draftCount: 0, createdAt: 't0', updatedAt: 't0', ...over,
  };
}

function reset(): void {
  state.plans = [];
  state.createResult = null;
  state.created = [];
  state.activated = [];
  state.renamed = [];
  state.discarded = [];
  state.invalidated = [];
  state.onEvent = null;
  localStorage.clear();
}

vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useConnection: () => ({ state: 'online' }),
  useWorkspaceEvents: (fn: (e: WorkspaceEvent) => void) => { state.onEvent = fn; },
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: (o: { queryKey: unknown[] }) => { state.invalidated.push(o.queryKey); } }) };
});

vi.mock('../api/hooks', () => ({
  usePlansMany: () => ({ plans: state.plans, isLoading: false }),
  useCreatePlan: () => ({
    isPending: false,
    mutate: (input: Record<string, unknown>, opts?: { onSuccess?: (r: { plan: { id: string; projectId: string; title?: string | null } }) => void }) => {
      state.created.push(input);
      const r = state.createResult;
      if (!r) return;
      state.plans = [...state.plans, plan({ id: r.id, projectId: r.projectId, title: null, titleSource: 'auto' })];
      opts?.onSuccess?.({ plan: { id: r.id, projectId: r.projectId, title: null } });
    },
  }),
  useActivatePlan: () => ({
    isPending: false,
    mutate: (input: Record<string, unknown>, opts?: { onSuccess?: (r: { plan: { id: string }; agent: { runtimeId: string } }) => void }) => {
      state.activated.push(input);
      opts?.onSuccess?.({ plan: { id: String(input.planId) }, agent: { runtimeId: 'claude' } });
    },
  }),
  useRenamePlan: () => ({
    isPending: false,
    mutate: (input: Record<string, unknown>) => {
      state.renamed.push(input);
      state.plans = state.plans.map((p) => (p.id === input.planId ? { ...p, title: String(input.title), titleSource: 'human' } : p));
    },
  }),
  useDiscardPlan: () => ({
    isPending: false,
    mutate: (input: Record<string, unknown>, opts?: { onSuccess?: () => void }) => {
      state.discarded.push(input);
      state.plans = state.plans.filter((p) => p.id !== input.planId);
      opts?.onSuccess?.();
    },
  }),
}));

const { usePlanTabs, PlanTabStrip } = await import('../v2/PlanTabs');

const PROJECTS: Project[] = [project({ id: 'p1', slug: 'api', name: 'API' }), project({ id: 'p2', slug: 'web', name: 'Web' })];

function Harness(): React.ReactElement {
  const t = usePlanTabs({ projects: PROJECTS });
  return (
    <PlanTabStrip
      projects={PROJECTS}
      tabs={t.tabs}
      focused={t.focused}
      busy={t.isCreating}
      onFocusWeaver={t.focusWeaver}
      onFocusPlan={t.focusPlan}
      onNewPlan={() => t.createPlan('p1')}
      onRename={t.renamePlan}
      onDiscard={t.discardPlan}
    />
  );
}

describe('the V2 chat tab strip (VS-556)', () => {
  beforeEach(() => reset());
  afterEach(() => vi.clearAllMocks());

  it('shows the weaver tab first and selected, plus one tab per drafting plan tagged with its project', () => {
    state.plans = [plan({ id: 'plan_1', projectId: 'p1', title: 'API work' }), plan({ id: 'plan_2', projectId: 'p2', title: 'Web work' })];
    render(<Harness />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAccessibleName('Weaver chat');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Plan: API work' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plan: Web work' })).toBeInTheDocument();
    // Each plan tab carries its project, so tabs from different projects are distinguishable.
    const apiTab = screen.getByRole('tab', { name: 'Plan: API work' });
    expect(apiTab.textContent).toContain('API');
    expect(screen.getByRole('tab', { name: 'Plan: Web work' }).textContent).toContain('Web');
  });

  it('creates and focuses a New plan in the chat’s selected project', () => {
    state.plans = [plan({ id: 'plan_1', projectId: 'p1', title: 'API work' })];
    state.createResult = { id: 'plan_9', projectId: 'p1' };
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'New plan' }));
    expect(state.created).toEqual([{ projectId: 'p1' }]);
    expect(screen.getByRole('tab', { name: 'Plan: New plan' })).toHaveAttribute('aria-selected', 'true');
    expect(state.activated.at(-1)).toEqual({ projectId: 'p1', planId: 'plan_9' });
  });

  it('switches tabs, activating the chosen plan, and back to the weaver', () => {
    state.plans = [plan({ id: 'plan_1', projectId: 'p1', title: 'API work' }), plan({ id: 'plan_2', projectId: 'p2', title: 'Web work' })];
    render(<Harness />);

    fireEvent.click(screen.getByRole('tab', { name: 'Plan: Web work' }));
    expect(screen.getByRole('tab', { name: 'Plan: Web work' })).toHaveAttribute('aria-selected', 'true');
    expect(state.activated.at(-1)).toEqual({ projectId: 'p2', planId: 'plan_2' });

    fireEvent.click(screen.getByRole('tab', { name: 'Weaver chat' }));
    expect(screen.getByRole('tab', { name: 'Weaver chat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Plan: Web work' })).toHaveAttribute('aria-selected', 'false');
  });

  it('renames a tab on double-click', () => {
    state.plans = [plan({ id: 'plan_1', projectId: 'p1', title: 'Old name' })];
    const { rerender } = render(<Harness />);
    fireEvent.doubleClick(screen.getByRole('tab', { name: 'Plan: Old name' }));
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Settings overhaul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(state.renamed).toEqual([{ projectId: 'p1', planId: 'plan_1', title: 'Settings overhaul' }]);
    // The mutation updates the plans the mocked hook reads; re-render the owner to read them back.
    rerender(<Harness />);
    expect(screen.getByRole('tab', { name: 'Plan: Settings overhaul' })).toBeInTheDocument();
  });

  it('deletes a plan from its tab only after a confirm', () => {
    state.plans = [plan({ id: 'plan_1', projectId: 'p1', title: 'API work' }), plan({ id: 'plan_2', projectId: 'p2', title: 'Web work' })];
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard plan API work' }));
    expect(state.discarded).toEqual([]);
    expect(screen.getByRole('alertdialog', { name: 'Discard this plan?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(state.discarded).toEqual([{ projectId: 'p1', planId: 'plan_1' }]);
    rerender(<Harness />);
    expect(screen.queryByRole('tab', { name: 'Plan: API work' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plan: Web work' })).toBeInTheDocument();
  });

  it('scrolls the tab strip horizontally with New plan outside the scroller', () => {
    state.plans = Array.from({ length: 6 }, (_, i) => plan({ id: `plan_${i}`, projectId: 'p1', title: `Plan number ${i}` }));
    render(<Harness />);
    const tablist = screen.getByRole('tablist', { name: 'Chats' });
    expect(tablist.className).toContain('overflow-x-auto');
    expect(tablist.className).toContain('min-w-0');
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(tablist.contains(screen.getByRole('button', { name: 'New plan' }))).toBe(false);
  });

  it('restores the remembered plan tab for the workspace, and falls back to the weaver when it is gone', () => {
    state.plans = [plan({ id: 'plan_1', projectId: 'p1', title: 'API work' })];
    localStorage.setItem('weave:plan:lastTab:ws1', 'plan_1');
    const first = render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Plan: API work' })).toHaveAttribute('aria-selected', 'true');
    expect(state.activated.at(-1)).toEqual({ projectId: 'p1', planId: 'plan_1' });
    first.unmount();

    // A remembered plan that is no longer a drafting plan resolves to the weaver tab.
    localStorage.setItem('weave:plan:lastTab:ws1', 'plan_missing');
    state.plans = [];
    render(<Harness />);
    expect(screen.getAllByRole('tab')[0]).toHaveAccessibleName('Weaver chat');
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('refreshes the strip when a plan.* event arrives out of band', () => {
    render(<Harness />);
    expect(state.onEvent).toBeTruthy();
    act(() => { state.onEvent?.({ type: 'plan.draft_added', entityType: 'plan_draft', entityId: 'd1', payload: { planId: 'plan_1' } } as unknown as WorkspaceEvent); });
    expect(state.invalidated).toContainEqual(['w', 'ws1', 'plans']);
  });
});
