/**
 * A plan's tab surface (VS-556, ported from the VS-398 Plan modal): the planner conversation and the
 * draft list, with the draft operations, dispatch and Submit. The shared composer is the weaver
 * chat's, so markdown, the turn summary and the live trace read identically (VS-442). Hooks are
 * mocked directly (the established V2 pattern), not a real QueryClient + fetch.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanDraft, Role, RunEvent, RunTrace, ThreadMessage, WorkspaceEvent } from '@weave-ai/shared';
import { project, role } from './factories';

const state = vi.hoisted(() => ({
  planId: 'plan_1',
  planStatus: 'drafting',
  drafts: [] as Array<PlanDraft & { blockedBy: string[]; ticketStatus?: string; report?: string | null }>,
  roles: [] as Role[],
  messages: [] as ThreadMessage[],
  traces: [] as RunTrace[],
  runEvents: [] as RunEvent[],
  runState: 'connected' as 'connected' | 'offline' | 'unreachable',
  posted: [] as Array<Record<string, unknown>>,
  patched: [] as Array<Record<string, unknown>>,
  removed: [] as Array<Record<string, unknown>>,
  dispatched: [] as Array<Record<string, unknown>>,
  submitted: [] as Array<Record<string, unknown>>,
  invalidated: [] as unknown[][],
  onEvent: null as ((e: WorkspaceEvent) => void) | null,
  listening: false,
  metered: false,
  go: vi.fn(),
  onSubmitted: vi.fn(),
}));

function resetState(): void {
  state.planId = 'plan_1';
  state.planStatus = 'drafting';
  state.drafts = [];
  state.roles = [];
  state.messages = [];
  state.traces = [];
  state.runEvents = [];
  state.runState = 'connected';
  state.posted = [];
  state.patched = [];
  state.removed = [];
  state.dispatched = [];
  state.submitted = [];
  state.invalidated = [];
  state.onEvent = null;
  state.listening = false;
  state.metered = false;
  state.go.mockReset();
  state.onSubmitted.mockReset();
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
  useDispatchPlanDraft: () => ({ isPending: false, mutate: (v: Record<string, unknown>) => { state.dispatched.push(v); } }),
  useSubmitPlan: () => ({
    isPending: false,
    mutate: (v: Record<string, unknown>, opts?: { onSuccess?: () => void }) => { state.submitted.push(v); opts?.onSuccess?.(); },
  }),
}));

const { PlanTab } = await import('../v2/PlanTab');

const PROJECTS = [project({ id: 'p1', slug: 'api', name: 'API' }), project({ id: 'p2', slug: 'web', name: 'Web' })];

type TestDraft = PlanDraft & { blockedBy: string[]; ticketStatus?: string; report?: string | null };
function draft(over: Partial<TestDraft> = {}): TestDraft {
  return {
    id: 'd1', planId: 'plan_1', position: 0, title: 'Add token plumbing', summary: null, description: '', kind: 'change',
    priority: 'medium', targetRoleId: null, suggestedTier: 'standard', tierOverride: null, status: 'pending',
    createdTicketId: null, failureReason: null, createdAt: 't0', updatedAt: 't0', blockedBy: [], ...over,
  };
}

function mount(props: Partial<React.ComponentProps<typeof PlanTab>> = {}): ReturnType<typeof render> {
  return render(
    <PlanTab ws="ws1" projectId="p1" planId="plan_1" projects={PROJECTS} focused plannerRuntimeId="claude" onSubmitted={state.onSubmitted} {...props} />,
  );
}

describe('PlanTab (VS-556, from VS-398/VS-442)', () => {
  beforeEach(() => resetState());
  afterEach(() => vi.clearAllMocks());

  it('renders the conversation and sends a message to the planner, with no project selector', () => {
    state.messages = [{ id: 'm1', threadId: 'th_plan', direction: 'inbound', authorKind: 'human', authorId: 'v', body: 'Let’s plan the redesign', replyToMessageIds: [], parts: [], createdAt: 't0' } as unknown as ThreadMessage];
    mount();
    expect(screen.getByText('Let’s plan the redesign')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    // Chat-only controls: Search, the Plan button and the project scope selector are all absent.
    expect(screen.queryByRole('button', { name: 'Search this conversation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan a body of work interactively' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Auto' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message the planner'), { target: { value: 'Start with the API' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(state.posted).toHaveLength(1);
    expect(state.posted[0]).toMatchObject({ threadId: 'th_plan', body: 'Start with the API', projectId: 'p1', files: [] });
  });

  it('sends an attachment through to the plan thread', () => {
    mount();
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('v2-composer-file-input'), { target: { files: [file] } });
    expect(screen.getByText('notes.txt')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message the planner'), { target: { value: 'see the notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(state.posted[0]).toMatchObject({ threadId: 'th_plan', body: 'see the notes', projectId: 'p1', files: [file] });
  });

  it('reports a queued message while the planner is replying', () => {
    mount();
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
    mount();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Depends on 1 draft')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand A' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'deep' })[0]!);
    expect(state.patched).toEqual([{ projectId: 'p1', planId: 'plan_1', draftId: 'a', patch: { tierOverride: 'deep' } }]);
  });

  it('clearing an override by re-selecting the suggested tier sends null', () => {
    state.drafts = [draft({ id: 'a', title: 'A', suggestedTier: 'standard', tierOverride: 'deep' })];
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Expand A' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'standard' })[0]!);
    expect(state.patched).toEqual([{ projectId: 'p1', planId: 'plan_1', draftId: 'a', patch: { tierOverride: null } }]);
  });

  it('collapses every draft card by default and expands one on demand, showing the draft count (VS-622)', () => {
    state.drafts = [
      draft({ id: 'a', title: 'A', summary: 'A summary', description: 'A full description.' }),
      draft({ id: 'b', title: 'B', summary: 'B summary', description: 'B full description.' }),
    ];
    mount();
    expect(screen.getByText('2 drafts')).toBeInTheDocument();
    // Collapsed: title and short summary only, no full description.
    expect(screen.getByText('A summary')).toBeInTheDocument();
    expect(screen.queryByText('A full description.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand A' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Expand A' }));
    expect(screen.getByText('A full description.')).toBeInTheDocument();
    // B stays collapsed.
    expect(screen.queryByText('B full description.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse A' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('falls back to the description’s first sentence when a draft has no summary (VS-622)', () => {
    state.drafts = [draft({ id: 'a', title: 'A', summary: null, description: 'First sentence. Second sentence.' })];
    mount();
    expect(screen.getByText('First sentence.')).toBeInTheDocument();
    expect(screen.queryByText('First sentence. Second sentence.')).not.toBeInTheDocument();
  });

  it('expands and collapses all draft cards at once (VS-622)', () => {
    state.drafts = [
      draft({ id: 'a', title: 'A', description: 'A full description. More detail.' }),
      draft({ id: 'b', title: 'B', description: 'B full description. More detail.' }),
    ];
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByText('A full description. More detail.')).toBeInTheDocument();
    expect(screen.getByText('B full description. More detail.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByText('A full description. More detail.')).not.toBeInTheDocument();
    expect(screen.queryByText('B full description. More detail.')).not.toBeInTheDocument();
  });

  it('keeps a card’s expanded state when the plan refreshes under it (VS-622)', () => {
    state.drafts = [draft({ id: 'a', title: 'A', description: 'A full description. More detail.' })];
    const { rerender } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Expand A' }));
    expect(screen.getByText('A full description. More detail.')).toBeInTheDocument();

    // The planner edits the draft — a fresh plan payload arrives, same draft id.
    state.drafts = [draft({ id: 'a', title: 'A (edited)', description: 'A full description. More detail.' })];
    rerender(<PlanTab ws="ws1" projectId="p1" planId="plan_1" projects={PROJECTS} focused plannerRuntimeId="claude" onSubmitted={state.onSubmitted} />);
    expect(screen.getByText('A (edited)')).toBeInTheDocument();
    expect(screen.getByText('A full description. More detail.')).toBeInTheDocument();
  });

  it('reorders with the up/down controls, disabled at the ends', () => {
    state.drafts = [draft({ id: 'a', title: 'A', position: 0 }), draft({ id: 'b', title: 'B', position: 1 })];
    mount();
    expect(screen.getByRole('button', { name: 'Move A up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move B down' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move B up' }));
    expect(state.patched).toEqual([{ projectId: 'p1', planId: 'plan_1', draftId: 'b', patch: { position: 0 } }]);
  });

  it('removes a draft', () => {
    state.drafts = [draft({ id: 'a', title: 'A' })];
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Remove A' }));
    expect(state.removed).toEqual([{ projectId: 'p1', planId: 'plan_1', draftId: 'a' }]);
  });

  it('shows Dispatch only for a pending scout draft in a drafting plan, never for other kinds (VS-517)', () => {
    state.drafts = [
      draft({ id: 'a', title: 'Scout it', kind: 'scout' }),
      draft({ id: 'b', title: 'Build it', kind: 'change' }),
    ];
    mount();
    expect(screen.getByRole('button', { name: 'Dispatch Scout it' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispatch Build it' })).not.toBeInTheDocument();
  });

  it('dispatches a scout draft', () => {
    state.drafts = [draft({ id: 'a', title: 'Scout it', kind: 'scout' })];
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch Scout it' }));
    expect(state.dispatched).toEqual([{ projectId: 'p1', planId: 'plan_1', draftId: 'a' }]);
  });

  it('does not offer Dispatch once the plan is no longer drafting', () => {
    state.planStatus = 'submitted';
    state.drafts = [draft({ id: 'a', title: 'Scout it', kind: 'scout' })];
    mount();
    expect(screen.queryByRole('button', { name: 'Dispatch Scout it' })).not.toBeInTheDocument();
  });

  it('shows a dispatched scout as running, then as reported once its ticket is terminal', () => {
    state.drafts = [draft({ id: 'a', title: 'Scout it', kind: 'scout', status: 'created', createdTicketId: 'tkt-9', ticketStatus: 'in_progress' })];
    const { rerender } = mount();
    expect(screen.getByText('Dispatched — running')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Scout it' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Scout it' })).not.toBeInTheDocument();

    state.drafts = [draft({ id: 'a', title: 'Scout it', kind: 'scout', status: 'created', createdTicketId: 'tkt-9', ticketStatus: 'done' })];
    rerender(<PlanTab ws="ws1" projectId="p1" planId="plan_1" projects={PROJECTS} focused plannerRuntimeId="claude" onSubmitted={state.onSubmitted} />);
    expect(screen.getByText('Reported')).toBeInTheDocument();
  });

  it('shows a failed dispatch with its reason', () => {
    state.drafts = [draft({ id: 'a', title: 'Scout it', kind: 'scout', status: 'failed', failureReason: 'no role fits' })];
    mount();
    expect(screen.getByText('Failed: no role fits')).toBeInTheDocument();
  });

  it('refreshes the plan when a dispatched draft\'s ticket status changes (VS-517)', () => {
    state.drafts = [draft({ id: 'a', title: 'Scout it', kind: 'scout', status: 'created', createdTicketId: 'tkt-9', ticketStatus: 'in_progress' })];
    mount();
    state.invalidated = [];
    act(() => { state.onEvent?.({ type: 'ticket.status', entityType: 'ticket', entityId: 'tkt-9', payload: {} } as unknown as WorkspaceEvent); });
    expect(state.invalidated).toContainEqual(['w', 'ws1', 'plans', 'plan_1']);
  });

  it('disables submit with no drafts, enables it once one exists, and tells its owner on submit', () => {
    const { rerender } = mount();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();

    state.drafts = [draft({ id: 'a', title: 'A' })];
    rerender(<PlanTab ws="ws1" projectId="p1" planId="plan_1" projects={PROJECTS} focused plannerRuntimeId="claude" onSubmitted={state.onSubmitted} />);
    expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(state.submitted).toEqual([{ projectId: 'p1', planId: 'plan_1' }]);
    expect(state.onSubmitted).toHaveBeenCalledWith('plan_1');
  });

  it('edits a draft’s title, summary, description, kind, priority and target role inline', () => {
    state.drafts = [draft({ id: 'a', title: 'A', description: 'Old body', kind: 'change', priority: 'medium', targetRoleId: null })];
    state.roles = [role({ id: 'r1', name: 'Platform Engineer' })];
    mount();

    fireEvent.click(screen.getByRole('button', { name: 'Edit A' }));
    fireEvent.change(screen.getByLabelText('Title of A'), { target: { value: 'A, revised' } });
    fireEvent.change(screen.getByLabelText('Summary of A'), { target: { value: 'Short note' } });
    fireEvent.change(screen.getByLabelText('Description of A'), { target: { value: 'New body' } });
    fireEvent.change(screen.getByLabelText('Kind of A'), { target: { value: 'task' } });
    fireEvent.change(screen.getByLabelText('Priority of A'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('Target role of A'), { target: { value: 'r1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(state.patched).toEqual([{
      projectId: 'p1', planId: 'plan_1', draftId: 'a',
      patch: { title: 'A, revised', summary: 'Short note', description: 'New body', kind: 'task', priority: 'high', targetRoleId: 'r1' },
    }]);
    expect(screen.queryByLabelText('Title of A')).not.toBeInTheDocument();
  });

  it('cancelling an edit discards the in-progress changes', () => {
    state.drafts = [draft({ id: 'a', title: 'A' })];
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit A' }));
    fireEvent.change(screen.getByLabelText('Title of A'), { target: { value: 'Something else' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.patched).toEqual([]);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('the phone tab switcher toggles which pane is marked visible', () => {
    state.drafts = [draft({ id: 'a', title: 'A' })];
    mount();
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

    const { container } = mount();
    expect(screen.getByTestId('v2-composer-listening')).toBeInTheDocument();
    const pane = container.querySelector('section[aria-label="Conversation with the planner"]') as HTMLElement;
    expect(pane.className).toContain('min-w-0');
    expect(pane.parentElement?.className).toContain('min-w-0');
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
    mount();
    expect(screen.getByRole('heading', { name: 'Approach' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('pnpm test').tagName).toBe('CODE');
  });

  it('renders a planner-published plan artifact as a card that opens the sandboxed reader (VS-622)', () => {
    state.messages = [{
      id: 'm1', threadId: 'th_plan', direction: 'outbound', authorKind: 'agent', authorId: 'planner_1',
      body: 'Artifact: graph', replyToMessageIds: [], createdAt: 't0',
      parts: [{
        type: 'card', title: 'Ticket graph', body: 'Plan artifact · diagram · revision 1',
        actions: [{ key: 'open', label: 'Open artifact', style: 'primary' }],
        ref: { kind: 'plan-artifact', planId: 'plan_1', key: 'graph', revision: 1 },
      }],
    } as unknown as ThreadMessage];
    mount();
    expect(screen.getByText('Ticket graph')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact' }));
    expect(state.go).toHaveBeenCalledWith('/w/$ws/plans/$planId/artifacts/$key', { params: { ws: 'ws1', planId: 'plan_1', key: 'graph' } });
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
    mount();
    const summary = document.querySelector('[data-chat-summary]') as HTMLElement;
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent(/Planner did/);
    expect(summary).toHaveTextContent(/7 tool calls/);
    expect(summary).toHaveTextContent(/18\.4k tok/);
    expect(summary).toHaveTextContent(/120k\/1M ctx/);
  });

  it('renders the live working trace in the plan tab while the planner is running (VS-442)', async () => {
    state.runEvents = [{
      id: 'e1', runId: 'pr1', seq: 1, ts: 't0', stream: 'stdout', level: 'info',
      type: 'assistant.text', payload: { text: 'Reading the plan template.' },
    } as RunEvent];
    mount();
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
    mount();
    expect(screen.getByText('A planner reply')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply to this message' })).not.toBeInTheDocument();
  });

  it('returns to the bottom and resumes following when a message is sent from a scrolled-up view (VS-451)', async () => {
    state.messages = [{
      id: 'm1', threadId: 'th_plan', direction: 'outbound', authorKind: 'agent', authorId: 'planner_1',
      body: 'History line', replyToMessageIds: [], parts: [], createdAt: '2026-09-13T09:00:00.000Z',
    } as unknown as ThreadMessage];
    const { container } = mount();
    await screen.findByText('History line');

    const el = container.querySelector('[data-v2-chat-scroll]') as HTMLElement;
    let top = 0;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 300 });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = Math.max(0, Math.min(v, 700)); } });

    top = 700;
    fireEvent.scroll(el);
    fireEvent.wheel(el, { deltaY: -120 });
    top = 100;
    fireEvent.scroll(el);
    expect(screen.getByRole('button', { name: /Scroll to bottom/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message the planner'), { target: { value: 'hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(state.posted).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Scroll to bottom/ })).toBeNull());
  });
});
