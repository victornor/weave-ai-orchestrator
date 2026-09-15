/**
 * The V2 Plan modal (VS-398): opens by resuming/starting a plan, renders the chat and the draft
 * list, and drives submit/discard/tier-override/reorder through the plan hooks. Hooks are mocked
 * directly (the established V2 pattern — see chat.test.tsx), not a real QueryClient + fetch.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanDraft, PlanSummary, Role, RunEvent, RunTrace, ThreadMessage, WorkspaceEvent } from '@weave-ai/shared';
import { project, role } from './factories';

const state = vi.hoisted(() => ({
  startCalls: [] as Array<{ projectId: string; title?: string }>,
  planId: null as string | null,
  planStatus: 'drafting' as string,
  tabs: [] as PlanSummary[],
  newPlanId: null as string | null,
  drafts: [] as Array<PlanDraft & { blockedBy: string[] }>,
  roles: [] as Role[],
  messages: [] as ThreadMessage[],
  traces: [] as RunTrace[],
  runEvents: [] as RunEvent[],
  runState: 'connected' as 'connected' | 'offline' | 'unreachable',
  created: [] as Array<Record<string, unknown>>,
  activated: [] as Array<Record<string, unknown>>,
  renamed: [] as Array<Record<string, unknown>>,
  posted: [] as Array<Record<string, unknown>>,
  patched: [] as Array<Record<string, unknown>>,
  removed: [] as Array<Record<string, unknown>>,
  submitted: [] as Array<Record<string, unknown>>,
  discarded: [] as Array<Record<string, unknown>>,
  invalidated: [] as unknown[][],
  onEvent: null as ((e: WorkspaceEvent) => void) | null,
  listening: false,
  metered: false,
  go: vi.fn(),
}));

function planTab(over: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: 'plan_1', projectId: 'p1', title: 'Redesign the settings page', titleSource: 'human',
    status: 'drafting', draftCount: 0, createdAt: 't0', updatedAt: 't0', ...over,
  };
}

function resetState(): void {
  state.startCalls = [];
  state.planId = 'plan_1';
  state.planStatus = 'drafting';
  state.tabs = [planTab()];
  state.newPlanId = null;
  state.drafts = [];
  state.roles = [];
  state.messages = [];
  state.traces = [];
  state.runEvents = [];
  state.runState = 'connected';
  state.created = [];
  state.activated = [];
  state.renamed = [];
  state.posted = [];
  state.patched = [];
  state.removed = [];
  state.submitted = [];
  state.discarded = [];
  state.invalidated = [];
  state.onEvent = null;
  state.listening = false;
  state.metered = false;
  state.go.mockReset();
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

// The shared composer's dictation hook talks to the Web Speech API and the daemon; the plan modal
// tests drive the listening state through `state` rather than opening a real recognizer.
vi.mock('../lib/dictation', () => ({
  useDictation: () => ({
    mode: 'upload', listening: state.listening, transcribing: false, settled: true, elapsed: 0,
    analyser: { current: null }, metered: state.metered, error: null,
    start: vi.fn(), stop: vi.fn(), toggle: vi.fn(),
    diagnostics: { enabled: false, count: 0, copy: vi.fn() },
  }),
}));

vi.mock('../app/link', () => ({ useGo: () => state.go }));

vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: state.runEvents, status: { state: state.runState }, retryNow: vi.fn() }),
}));

vi.mock('../api/hooks', () => ({
  useStartOrResumePlan: () => ({
    mutate: (input: { projectId: string; title?: string }, opts?: { onSuccess?: (r: { plan: { id: string }; agent: { id: string; status: string; runtimeId: string } }) => void }) => {
      state.startCalls.push(input);
      if (state.planId) opts?.onSuccess?.({ plan: { id: state.planId }, agent: { id: 'planner_1', status: 'active', runtimeId: 'claude' } });
    },
  }),
  // VS-477: the tab list and the per-tab mutations. The mutations mutate `state.tabs` the way the
  // server would, so the focus-after-delete/submit behaviour is exercised rather than stubbed away.
  usePlans: () => ({ data: { plans: state.tabs } }),
  useCreatePlan: () => ({
    isPending: false,
    mutate: (input: Record<string, unknown>, opts?: { onSuccess?: (r: { plan: { id: string; projectId: string }; agent: { id: string; status: string; runtimeId: string } }) => void }) => {
      state.created.push(input);
      if (state.newPlanId) {
        const tab = planTab({ id: state.newPlanId, projectId: String(input.projectId), title: null, titleSource: 'auto' });
        state.tabs = [...state.tabs, tab];
        opts?.onSuccess?.({ plan: { id: tab.id, projectId: tab.projectId }, agent: { id: 'planner_2', status: 'active', runtimeId: 'claude' } });
      }
    },
  }),
  useActivatePlan: () => ({
    isPending: false,
    mutate: (input: Record<string, unknown>, opts?: { onSuccess?: (r: { plan: { id: string }; agent: { id: string; status: string; runtimeId: string } }) => void }) => {
      state.activated.push(input);
      opts?.onSuccess?.({ plan: { id: String(input.planId) }, agent: { id: 'planner_1', status: 'active', runtimeId: 'claude' } });
    },
  }),
  useRenamePlan: () => ({
    isPending: false,
    mutate: (input: Record<string, unknown>) => {
      state.renamed.push(input);
      state.tabs = state.tabs.map((t) => (t.id === input.planId ? { ...t, title: String(input.title), titleSource: 'human' } : t));
    },
  }),
  usePlan: (_projectId: string | null, planId: string | null) => ({
    data: planId ? { plan: { id: planId, status: state.planStatus, threadId: 'th_plan', agentId: 'planner_1' }, drafts: state.drafts } : undefined,
  }),
  useRoles: () => ({ data: state.roles }),
  useThreadMessages: () => ({ data: state.messages, isError: false }),
  useRunTraces: () => ({ data: state.traces }),
  useRunEvents: () => ({ data: [] }),
  useRuntimes: () => ({ data: [{ id: 'claude', capabilities: { contextCompactionAt: 0.8 } }] }),
  useRuntimeModels: () => ({ data: [{ id: 'sonnet', contextWindowTokens: 1_000_000 }] }),
  usePostThreadMessage: () => ({
    mutate: (v: Record<string, unknown>) => { state.posted.push(v); },
    mutateAsync: (v: Record<string, unknown>) => { state.posted.push(v); return Promise.resolve(); },
  }),
  usePatchPlanDraft: () => ({ mutate: (v: Record<string, unknown>, opts?: { onSuccess?: () => void }) => { state.patched.push(v); opts?.onSuccess?.(); }, isPending: false }),
  useRemovePlanDraft: () => ({ mutate: (v: Record<string, unknown>) => { state.removed.push(v); } }),
  useSubmitPlan: () => ({
    isPending: false,
    mutate: (v: Record<string, unknown>, opts?: { onSuccess?: () => void }) => {
      state.submitted.push(v);
      state.tabs = state.tabs.filter((t) => t.id !== v.planId);
      opts?.onSuccess?.();
    },
  }),
  useDiscardPlan: () => ({
    isPending: false,
    mutate: (v: Record<string, unknown>, opts?: { onSuccess?: () => void }) => {
      state.discarded.push(v);
      state.tabs = state.tabs.filter((t) => t.id !== v.planId);
      opts?.onSuccess?.();
    },
  }),
}));

const { PlanModal } = await import('../v2/PlanModal');

const PROJECTS = [project({ id: 'p1', slug: 'api', name: 'API' }), project({ id: 'p2', slug: 'web', name: 'Web' })];

function draft(over: Partial<PlanDraft & { blockedBy: string[] }> = {}): PlanDraft & { blockedBy: string[] } {
  return {
    id: 'd1', planId: 'plan_1', position: 0, title: 'Add token plumbing', description: '', kind: 'change',
    priority: 'medium', targetRoleId: null, suggestedTier: 'standard', tierOverride: null, status: 'pending',
    createdTicketId: null, failureReason: null, createdAt: 't0', updatedAt: 't0', blockedBy: [], ...over,
  };
}

describe('PlanModal (VS-398)', () => {
  beforeEach(() => resetState());
  afterEach(() => vi.clearAllMocks());

  it('renders nothing when closed', () => {
    const { container } = render(<PlanModal open={false} onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('focuses the project\'s drafting plan tab on open, without creating one (VS-477)', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(state.activated).toEqual([{ projectId: 'p1', planId: 'plan_1' }]);
    expect(screen.getByRole('dialog', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plan: Redesign the settings page' })).toHaveAttribute('aria-selected', 'true');
  });

  it('defaults to the first project when none is given', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId={null} />);
    expect(state.activated).toEqual([{ projectId: 'p1', planId: 'plan_1' }]);
  });

  it('shows an empty state with New plan when the project has no drafting plans (VS-477)', () => {
    state.tabs = [];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New plan' })).toBeInTheDocument();
    expect(state.activated).toEqual([]);
  });

  it('renders the conversation and sends a message', () => {
    state.messages = [{ id: 'm1', threadId: 'th_plan', direction: 'inbound', authorKind: 'human', authorId: 'v', body: 'Let’s plan the redesign', replyToMessageIds: [], parts: [], createdAt: 't0' } as unknown as ThreadMessage];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByText('Let’s plan the redesign')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message the planner'), { target: { value: 'Start with the API' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(state.posted).toHaveLength(1);
    expect(state.posted[0]).toMatchObject({ threadId: 'th_plan', body: 'Start with the API', projectId: 'p1', files: [] });
    expect(typeof (state.posted[0] as { idempotencyKey?: unknown }).idempotencyKey).toBe('string');
  });

  it('renders the shared composer with attach and dictate controls and hides the chat-only chrome', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    // Chat-only controls: Search, Plan, and the project scope selector (its `Auto` chip).
    expect(screen.queryByRole('button', { name: 'Search this conversation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan a body of work interactively' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Auto' })).not.toBeInTheDocument();
  });

  it('sends an attachment through to the plan thread', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('v2-composer-file-input'), { target: { files: [file] } });
    expect(screen.getByText('notes.txt')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message the planner'), { target: { value: 'see the notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(state.posted).toHaveLength(1);
    expect(state.posted[0]).toMatchObject({ threadId: 'th_plan', body: 'see the notes', projectId: 'p1', files: [file] });
  });

  it('shows an attachment already sent on a plan message', () => {
    state.messages = [{
      id: 'm1', threadId: 'th_plan', direction: 'inbound', authorKind: 'human', authorId: 'v', body: 'here it is',
      replyToMessageIds: [], parts: [{ type: 'attachment', id: 'att1', filename: 'notes.txt', mediaType: 'text/plain', byteSize: 1234 }],
      createdAt: 't0',
    } as unknown as ThreadMessage];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByRole('link', { name: /notes.txt/ })).toBeInTheDocument();
  });

  it('reports a queued message while the planner is replying', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.queryByText('Planner is replying — your message is queued')).not.toBeInTheDocument();

    act(() => {
      state.onEvent?.({ seq: 1, workspaceId: 'ws1', type: 'run.started', entityType: 'run', entityId: 'r1', payload: { agentId: 'planner_1' }, createdAt: 't0' });
    });
    expect(screen.getByText('Planner is replying — your message is queued')).toBeInTheDocument();

    act(() => {
      state.onEvent?.({ seq: 2, workspaceId: 'ws1', type: 'run.finished', entityType: 'run', entityId: 'r1', payload: { agentId: 'planner_1' }, createdAt: 't1' });
    });
    expect(screen.queryByText('Planner is replying — your message is queued')).not.toBeInTheDocument();
  });

  it('renders drafts with dependencies, and overrides a tier', () => {
    state.drafts = [
      draft({ id: 'a', title: 'A', position: 0 }),
      draft({ id: 'b', title: 'B', position: 1, suggestedTier: 'quick', blockedBy: ['a'] }),
    ];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Depends on 1 draft')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'deep' })[0]!);
    expect(state.patched).toEqual([{ projectId: 'p1', planId: 'plan_1', draftId: 'a', patch: { tierOverride: 'deep' } }]);
  });

  it('clearing an override by re-selecting the suggested tier sends null', () => {
    state.drafts = [draft({ id: 'a', title: 'A', suggestedTier: 'standard', tierOverride: 'deep' })];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'standard' })[0]!);
    expect(state.patched).toEqual([{ projectId: 'p1', planId: 'plan_1', draftId: 'a', patch: { tierOverride: null } }]);
  });

  it('reorders with the up/down controls, disabled at the ends', () => {
    state.drafts = [draft({ id: 'a', title: 'A', position: 0 }), draft({ id: 'b', title: 'B', position: 1 })];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByRole('button', { name: 'Move A up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move B down' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move B up' }));
    expect(state.patched).toEqual([{ projectId: 'p1', planId: 'plan_1', draftId: 'b', patch: { position: 0 } }]);
  });

  it('removes a draft', () => {
    state.drafts = [draft({ id: 'a', title: 'A' })];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove A' }));
    expect(state.removed).toEqual([{ projectId: 'p1', planId: 'plan_1', draftId: 'a' }]);
  });

  it('disables submit with no drafts, enables it once one exists, and closes its tab on submit (VS-477)', () => {
    const onClose = vi.fn();
    const { rerender } = render(<PlanModal open onClose={onClose} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();

    state.drafts = [draft({ id: 'a', title: 'A' })];
    rerender(<PlanModal open onClose={onClose} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(state.submitted).toEqual([{ projectId: 'p1', planId: 'plan_1' }]);
    // The submitted plan's tab is gone; the last tab closing leaves the empty state, not a close.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New plan' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('submitting one tab leaves the others (VS-477)', () => {
    state.tabs = [planTab({ id: 'plan_1' }), planTab({ id: 'plan_2', title: 'Second plan' })];
    state.drafts = [draft({ id: 'a', title: 'A' })];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.queryByRole('tab', { name: 'Plan: Redesign the settings page' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plan: Second plan' })).toBeInTheDocument();
  });

  it('deletes a plan from its tab after a confirm, without executing it (VS-477)', () => {
    state.tabs = [planTab({ id: 'plan_1' }), planTab({ id: 'plan_2', title: 'Second plan', titleSource: 'auto' })];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan Redesign the settings page' }));
    // Nothing is discarded until the confirm is accepted.
    expect(state.discarded).toEqual([]);
    expect(screen.getByRole('alertdialog', { name: 'Delete plan?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(state.discarded).toEqual([{ projectId: 'p1', planId: 'plan_1' }]);
    expect(screen.queryByRole('tab', { name: 'Plan: Redesign the settings page' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plan: Second plan' })).toBeInTheDocument();
  });

  it('keeps the plan when the delete confirm is cancelled (VS-477)', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan Redesign the settings page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.discarded).toEqual([]);
    expect(screen.getByRole('tab', { name: 'Plan: Redesign the settings page' })).toBeInTheDocument();
  });

  it('deleting the last tab leaves the empty state (VS-477)', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan Redesign the settings page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New plan' })).toBeInTheDocument();
  });

  it('New plan creates and focuses a fresh tab (VS-477)', () => {
    state.newPlanId = 'plan_2';
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'New plan' }));
    expect(state.created).toEqual([{ projectId: 'p1' }]);
    // The new (untitled) tab appears and is focused; the existing plan stays.
    expect(screen.getByRole('tab', { name: 'Plan: New plan' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Plan: Redesign the settings page' })).toBeInTheDocument();
    expect(state.activated.at(-1)).toEqual({ projectId: 'p1', planId: 'plan_2' });
  });

  it('scrolls the tab strip horizontally and keeps New plan visible with many tabs (VS-477)', () => {
    state.tabs = Array.from({ length: 6 }, (_, i) => planTab({ id: `plan_${i}`, title: `Plan number ${i}` }));
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    const tablist = screen.getByRole('tablist', { name: 'Plans' });
    expect(tablist.className).toContain('overflow-x-auto');
    expect(tablist.className).toContain('min-w-0');
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    // New plan is a sibling of the scroller, never inside it, so a long strip cannot scroll it away.
    const newPlan = screen.getByRole('button', { name: 'New plan' });
    expect(tablist.contains(newPlan)).toBe(false);
  });

  it('switching tabs focuses that plan and loads its conversation (VS-477)', () => {
    state.tabs = [planTab({ id: 'plan_1' }), planTab({ id: 'plan_2', title: 'Second plan' })];
    state.messages = [{ id: 'm1', threadId: 'th_plan', direction: 'inbound', authorKind: 'human', authorId: 'v', body: 'Second plan chat', replyToMessageIds: [], parts: [], createdAt: 't0' } as unknown as ThreadMessage];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Plan: Second plan' }));
    expect(state.activated.at(-1)).toEqual({ projectId: 'p1', planId: 'plan_2' });
    expect(screen.getByRole('tab', { name: 'Plan: Second plan' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Second plan chat')).toBeInTheDocument();
  });

  it('renames a tab on double-click (VS-477)', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.doubleClick(screen.getByRole('tab', { name: 'Plan: Redesign the settings page' }));
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Settings overhaul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(state.renamed).toEqual([{ projectId: 'p1', planId: 'plan_1', title: 'Settings overhaul' }]);
    expect(screen.getByRole('tab', { name: 'Plan: Settings overhaul' })).toBeInTheDocument();
  });

  it('shows the New plan placeholder for an untitled, auto-titled tab (VS-477)', () => {
    state.tabs = [planTab({ id: 'plan_1', title: null, titleSource: 'auto' })];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByRole('tab', { name: 'Plan: New plan' })).toBeInTheDocument();
  });

  it('switches the project scope and focuses that project’s plan (VS-477)', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Web' }));
    expect(state.activated.at(-1)).toEqual({ projectId: 'p2', planId: 'plan_1' });
  });

  it('invalidates the tab list and the open plan when a plan.* event arrives out of band (VS-477)', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(state.onEvent).toBeTruthy();
    const list = ['w', 'ws1', 'plans', 'project', 'p1'];

    // A plan-level event names the plan as its entity; the tab list is always refreshed too.
    state.onEvent?.({ seq: 1, workspaceId: 'ws1', type: 'plan.submitted', entityType: 'plan', entityId: 'plan_1', payload: {}, createdAt: 't0' });
    expect(state.invalidated).toEqual([list, ['w', 'ws1', 'plans', 'plan_1']]);

    // A draft-level event names its own id as the entity, and the plan only in its payload.
    state.onEvent?.({ seq: 2, workspaceId: 'ws1', type: 'plan.draft_added', entityType: 'plan_draft', entityId: 'd1', payload: { planId: 'plan_1' }, createdAt: 't1' });
    expect(state.invalidated).toEqual([list, ['w', 'ws1', 'plans', 'plan_1'], list, ['w', 'ws1', 'plans', 'plan_1']]);

    // An event for a different plan refreshes the list only; a non-plan event is ignored.
    state.onEvent?.({ seq: 3, workspaceId: 'ws1', type: 'plan.discarded', entityType: 'plan', entityId: 'plan_2', payload: {}, createdAt: 't2' });
    expect(state.invalidated.at(-1)).toEqual(list);
    state.onEvent?.({ seq: 4, workspaceId: 'ws1', type: 'run.finished', entityType: 'run', entityId: 'r1', payload: {}, createdAt: 't3' });
    expect(state.invalidated).toHaveLength(5);
  });

  it('edits a draft’s title, description, kind, priority and target role inline', () => {
    state.drafts = [draft({ id: 'a', title: 'A', description: 'Old body', kind: 'change', priority: 'medium', targetRoleId: null })];
    state.roles = [role({ id: 'r1', name: 'Platform Engineer' })];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit A' }));
    fireEvent.change(screen.getByLabelText('Title of A'), { target: { value: 'A, revised' } });
    fireEvent.change(screen.getByLabelText('Description of A'), { target: { value: 'New body' } });
    fireEvent.change(screen.getByLabelText('Kind of A'), { target: { value: 'task' } });
    fireEvent.change(screen.getByLabelText('Priority of A'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('Target role of A'), { target: { value: 'r1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(state.patched).toEqual([{
      projectId: 'p1', planId: 'plan_1', draftId: 'a',
      patch: { title: 'A, revised', description: 'New body', kind: 'task', priority: 'high', targetRoleId: 'r1' },
    }]);
    // The edit form closes on a successful save.
    expect(screen.queryByLabelText('Title of A')).not.toBeInTheDocument();
  });

  it('cancelling an edit discards the in-progress changes', () => {
    state.drafts = [draft({ id: 'a', title: 'A' })];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit A' }));
    fireEvent.change(screen.getByLabelText('Title of A'), { target: { value: 'Something else' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.patched).toEqual([]);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('the phone tab switcher toggles which pane is marked visible', () => {
    state.drafts = [draft({ id: 'a', title: 'A' })];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    const chatTab = screen.getByRole('button', { name: 'Chat' });
    const draftsTab = screen.getByRole('button', { name: 'Drafts (1)' });
    expect(chatTab).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(draftsTab);
    expect(draftsTab).toHaveAttribute('aria-pressed', 'true');
    expect(chatTab).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the conversation pane width-constrained while dictation is listening (VS-431)', () => {
    state.listening = true;
    state.metered = true;
    const ctx = {
      setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      arcTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), globalAlpha: 1, fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);

    const { container } = render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);

    expect(screen.getByTestId('v2-composer-listening')).toBeInTheDocument();
    // The pane and its flex row are what contain a wide child; without min-w-0 a child's intrinsic
    // width (the meter canvas's `width` attribute) can push them wider.
    const pane = container.querySelector('section[aria-label="Conversation with the planner"]') as HTMLElement;
    expect(pane.className).toContain('min-w-0');
    expect(pane.parentElement?.className).toContain('min-w-0');
    // The canvas is a percentage of its sized box, so its backing store cannot become its layout size.
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.className).toMatch(/\bw-full\b/);
    expect(canvas.className).toMatch(/\bh-full\b/);
  });

  it('renders a planner reply as markdown, not a plain-text bubble (VS-442)', () => {
    state.messages = [{
      id: 'm1', threadId: 'th_plan', direction: 'outbound', authorKind: 'agent', authorId: 'planner_1',
      body: '## Approach\n\n- first step\n- second step\n\nRun `pnpm test` before you push.',
      replyToMessageIds: [], parts: [], createdAt: 't0',
    } as unknown as ThreadMessage];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByRole('heading', { name: 'Approach' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('pnpm test').tagName).toBe('CODE');
  });

  it('summarises a finished planner turn as “Planner did …” with tools, tokens and session (VS-442)', () => {
    state.messages = [{
      id: 'm1', threadId: 'th_plan', direction: 'outbound', authorKind: 'agent', authorId: 'planner_1', runId: 'pr1',
      body: 'Drafted two tickets.', replyToMessageIds: [], parts: [], createdAt: 't0',
    } as unknown as ThreadMessage];
    state.traces = [{
      runId: 'pr1', status: 'succeeded', agentId: 'planner_1', createdAt: 't0', startedAt: 't0', finishedAt: 't1',
      durationMs: 34_000, toolCalls: 7, files: 0, errors: 0, texts: 2, events: 10, summary: null, model: 'sonnet',
      usage: { inputTokens: 10_000, outputTokens: 8_400, cachedInputTokens: 0, contextTokens: 120_000, basis: 'reported' },
    }];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    const summary = document.querySelector('[data-chat-summary]') as HTMLElement;
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent(/Planner did/);
    expect(summary).toHaveTextContent(/7 tool calls/);
    expect(summary).toHaveTextContent(/18\.4k tok/);
    expect(summary).toHaveTextContent(/120k\/1M ctx/);
  });

  it('renders the live working trace in the modal while the planner is running (VS-442)', async () => {
    state.runEvents = [{
      id: 'e1', runId: 'pr1', seq: 1, ts: 't0', stream: 'stdout', level: 'info',
      type: 'assistant.text', payload: { text: 'Reading the plan template.' },
    } as RunEvent];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    act(() => {
      state.onEvent?.({ seq: 1, workspaceId: 'ws1', type: 'run.started', entityType: 'run', entityId: 'pr1', payload: { agentId: 'planner_1' }, createdAt: 't0' });
    });
    expect(screen.getByLabelText('Planner is working')).toBeInTheDocument();
    expect(await screen.findByText('Reading the plan template.')).toBeInTheDocument();
  });

  it('hides the weaver-only reply control in the planner conversation (VS-442)', () => {
    state.messages = [{
      id: 'm1', threadId: 'th_plan', direction: 'outbound', authorKind: 'agent', authorId: 'planner_1',
      body: 'A planner reply', replyToMessageIds: [], parts: [], createdAt: 't0',
    } as unknown as ThreadMessage];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByText('A planner reply')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply to this message' })).not.toBeInTheDocument();
  });

  it('returns to the bottom and resumes following when a message is sent from a scrolled-up view (VS-451)', async () => {
    state.messages = [{
      id: 'm1', threadId: 'th_plan', direction: 'outbound', authorKind: 'agent', authorId: 'planner_1',
      body: 'History line', replyToMessageIds: [], parts: [], createdAt: '2026-09-13T09:00:00.000Z',
    } as unknown as ThreadMessage];
    const { container } = render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    await screen.findByText('History line');

    // jsdom has no layout: stage the scroller's geometry so a scroll-up can be observed at all.
    const el = container.querySelector('[data-v2-chat-scroll]') as HTMLElement;
    let top = 0;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 300 });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = Math.max(0, Math.min(v, 700)); } });

    // At the bottom first, so an upward move is recognisable, then a wheel scroll up: the follow
    // pauses and the button appears.
    top = 700;
    fireEvent.scroll(el);
    fireEvent.wheel(el, { deltaY: -120 });
    top = 100;
    fireEvent.scroll(el);
    expect(screen.getByRole('button', { name: /Scroll to bottom/ })).toBeInTheDocument();

    // Sending returns the planner conversation to the bottom and resumes following.
    fireEvent.change(screen.getByLabelText('Message the planner'), { target: { value: 'hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(state.posted).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Scroll to bottom/ })).toBeNull());
  });
});
