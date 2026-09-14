/**
 * The V2 Plan modal (VS-398): opens by resuming/starting a plan, renders the chat and the draft
 * list, and drives submit/discard/tier-override/reorder through the plan hooks. Hooks are mocked
 * directly (the established V2 pattern — see chat.test.tsx), not a real QueryClient + fetch.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanDraft, Role, ThreadMessage, WorkspaceEvent } from '@weave-ai/shared';
import { project, role } from './factories';

const state = vi.hoisted(() => ({
  startCalls: [] as Array<{ projectId: string; title?: string }>,
  planId: null as string | null,
  planStatus: 'drafting' as string,
  drafts: [] as Array<PlanDraft & { blockedBy: string[] }>,
  roles: [] as Role[],
  messages: [] as ThreadMessage[],
  posted: [] as Array<Record<string, unknown>>,
  patched: [] as Array<Record<string, unknown>>,
  removed: [] as Array<Record<string, unknown>>,
  submitted: [] as Array<Record<string, unknown>>,
  discarded: [] as Array<Record<string, unknown>>,
  invalidated: [] as unknown[][],
  onEvent: null as ((e: WorkspaceEvent) => void) | null,
}));

function resetState(): void {
  state.startCalls = [];
  state.planId = 'plan_1';
  state.planStatus = 'drafting';
  state.drafts = [];
  state.roles = [];
  state.messages = [];
  state.posted = [];
  state.patched = [];
  state.removed = [];
  state.submitted = [];
  state.discarded = [];
  state.invalidated = [];
  state.onEvent = null;
}

vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useWorkspaceEvents: (fn: (e: WorkspaceEvent) => void) => { state.onEvent = fn; },
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: (o: { queryKey: unknown[] }) => { state.invalidated.push(o.queryKey); } }) };
});

vi.mock('../api/hooks', () => ({
  useStartOrResumePlan: () => ({
    mutate: (input: { projectId: string; title?: string }, opts?: { onSuccess?: (r: { plan: { id: string } }) => void }) => {
      state.startCalls.push(input);
      if (state.planId) opts?.onSuccess?.({ plan: { id: state.planId } });
    },
  }),
  usePlan: (_projectId: string | null, planId: string | null) => ({
    data: planId ? { plan: { id: planId, status: state.planStatus, threadId: 'th_plan' }, drafts: state.drafts } : undefined,
  }),
  useRoles: () => ({ data: state.roles }),
  useThreadMessages: () => ({ data: state.messages }),
  usePostThreadMessage: () => ({ mutate: (v: Record<string, unknown>) => { state.posted.push(v); } }),
  usePatchPlanDraft: () => ({ mutate: (v: Record<string, unknown>, opts?: { onSuccess?: () => void }) => { state.patched.push(v); opts?.onSuccess?.(); }, isPending: false }),
  useRemovePlanDraft: () => ({ mutate: (v: Record<string, unknown>) => { state.removed.push(v); } }),
  useSubmitPlan: () => ({ mutate: (v: Record<string, unknown>, opts?: { onSuccess?: () => void }) => { state.submitted.push(v); opts?.onSuccess?.(); }, isPending: false }),
  useDiscardPlan: () => ({ mutate: (v: Record<string, unknown>, opts?: { onSuccess?: () => void }) => { state.discarded.push(v); opts?.onSuccess?.(); } }),
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

  it('starts or resumes the plan for the given project on open', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(state.startCalls).toEqual([{ projectId: 'p1' }]);
    expect(screen.getByRole('dialog', { name: 'Plan' })).toBeInTheDocument();
  });

  it('defaults to the first project when none is given', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId={null} />);
    expect(state.startCalls).toEqual([{ projectId: 'p1' }]);
  });

  it('renders the conversation and sends a message', () => {
    state.messages = [{ id: 'm1', threadId: 'th_plan', direction: 'inbound', authorKind: 'human', authorId: 'v', body: 'Let’s plan the redesign', parts: [], createdAt: 't0' } as unknown as ThreadMessage];
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByText('Let’s plan the redesign')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message the planner'), { target: { value: 'Start with the API' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(state.posted).toEqual([{ threadId: 'th_plan', body: 'Start with the API', projectId: 'p1' }]);
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

  it('disables submit with no drafts, enables it once one exists, and closes on submit', () => {
    const onClose = vi.fn();
    const { rerender } = render(<PlanModal open onClose={onClose} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();

    state.drafts = [draft({ id: 'a', title: 'A' })];
    rerender(<PlanModal open onClose={onClose} projects={PROJECTS} projectId="p1" />);
    expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(state.submitted).toEqual([{ projectId: 'p1', planId: 'plan_1' }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('discards the plan and closes', () => {
    const onClose = vi.fn();
    render(<PlanModal open onClose={onClose} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(state.discarded).toEqual([{ projectId: 'p1', planId: 'plan_1' }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches the project scope and starts that project’s plan', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Web' }));
    expect(state.startCalls.at(-1)).toEqual({ projectId: 'p2' });
  });

  it('invalidates the plan query when a matching plan.* event arrives out of band', () => {
    render(<PlanModal open onClose={vi.fn()} projects={PROJECTS} projectId="p1" />);
    expect(state.onEvent).toBeTruthy();

    // A plan-level event names the plan as its entity.
    state.onEvent?.({ seq: 1, workspaceId: 'ws1', type: 'plan.submitted', entityType: 'plan', entityId: 'plan_1', payload: {}, createdAt: 't0' });
    expect(state.invalidated).toEqual([['w', 'ws1', 'plans', 'plan_1']]);

    // A draft-level event names its own id as the entity, and the plan only in its payload.
    state.onEvent?.({ seq: 2, workspaceId: 'ws1', type: 'plan.draft_added', entityType: 'plan_draft', entityId: 'd1', payload: { planId: 'plan_1' }, createdAt: 't1' });
    expect(state.invalidated).toEqual([['w', 'ws1', 'plans', 'plan_1'], ['w', 'ws1', 'plans', 'plan_1']]);

    // An event for a different plan, or a non-plan event, is ignored.
    state.onEvent?.({ seq: 3, workspaceId: 'ws1', type: 'plan.discarded', entityType: 'plan', entityId: 'plan_2', payload: {}, createdAt: 't2' });
    state.onEvent?.({ seq: 4, workspaceId: 'ws1', type: 'run.finished', entityType: 'run', entityId: 'r1', payload: {}, createdAt: 't3' });
    expect(state.invalidated).toHaveLength(2);
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
});
