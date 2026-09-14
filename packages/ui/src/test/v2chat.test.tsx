/**
 * VS-349: the V2 Chat screen — the split conversation/decisions layout and its collapse threshold,
 * the status bar's figures, message metadata and the collapsed summary line, inline ticket reference
 * tags, attachment rows, answering a decision in the pane, the kept search, and the draft that
 * survives remounting the screen.
 * VS-412: the live ticket and worker chips — a turn's dispatches under its reply and the row of
 * unattributed live workers.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Agent, Decision, RunEvent, RunTrace, ThreadMessage, Ticket } from '@weave-ai/shared';
import { agent, ticket } from './factories';

const state = vi.hoisted(() => ({
  width: 900,
  messages: [] as ThreadMessage[],
  decisions: [] as Decision[],
  traces: [] as RunTrace[],
  tickets: [] as Ticket[],
  workers: [] as Agent[],
  search: [] as Array<{ messageId: string; authorKind: string; authorId: string | null; createdAt: string; snippet: string }>,
  context: [] as ThreadMessage[],
  events: [] as unknown[],
  runEvents: [] as RunEvent[],
  runStreams: [] as Array<{ id: string | null; live: boolean }>,
  runState: 'connected' as 'connected' | 'offline' | 'unreachable',
  lastRun: null as { id: string; status: string } | null,
  answer: vi.fn(),
  post: vi.fn(),
  go: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => '/v2/w/ws1/chat',
  useParams: () => ({}),
}));
vi.mock('../app/link', () => ({
  A: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useGo: () => state.go,
}));
vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useConnection: () => ({ state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 }),
  useWorkspaceEvents: () => undefined,
}));
// ChatPage always renders PlanModal, which calls useQueryClient() to invalidate on `plan.*` events (VS-398)
// — these tests never mount a real QueryClientProvider, so stub it rather than pull one in unused.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: () => undefined }) };
});
vi.mock('../api/runStream', () => ({
  useRunEventStream: (id: string | null, opts?: { live?: boolean }) => {
    state.runStreams.push({ id, live: opts?.live ?? false });
    return { events: state.runEvents, status: { state: state.runState }, retryNow: vi.fn() };
  },
}));
vi.mock('../v2/chatSplit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../v2/chatSplit')>();
  return { ...actual, useElementWidth: () => ({ ref: () => undefined, width: state.width }) };
});
vi.mock('../api/hooks', () => ({
  ACCOUNTS_REFRESH_MS: 300_000,
  useThreads: () => ({ data: [{ id: 't1' }], isSuccess: true }),
  useCreateThread: () => ({ data: { id: 't1' }, mutate: vi.fn(), isPending: false }),
  useThreadMessages: () => ({
    data: state.messages,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isLoadingOlder: false,
    hasOlder: false,
    loadOlder: vi.fn(),
  }),
  usePostThreadMessage: () => ({ mutateAsync: state.post, mutate: state.post, isPending: false }),
  useDecisions: (params: { status?: string | string[] } = {}) => {
    const wanted = params.status === undefined ? ['open'] : Array.isArray(params.status) ? params.status : [params.status];
    return { data: state.decisions.filter((d) => wanted.includes(d.status)), isSuccess: true };
  },
  useAnswerDecision: () => ({ mutate: state.answer, isPending: false }),
  useWorkers: () => ({ data: state.workers }),
  useProjects: () => ({ data: [{ id: 'p1', workspaceId: 'ws1', slug: 'web', name: 'web' }] }),
  useTickets: () => ({ data: state.tickets }),
  useWeaver: () => ({ data: { agent: { id: 'weaver1', runtimeId: 'claude' }, lastRun: state.lastRun } }),
  useRuntimes: () => ({ data: [{ id: 'claude', capabilities: { contextCompactionAt: 0.8 } }] }),
  useRuntimeModels: () => ({ data: [{ id: 'sonnet', contextWindowTokens: 1_000_000 }] }),
  useUsageAccounts: () => ({
    data: [
      {
        workspaceId: 'ws1',
        runtimeId: 'claude',
        billingType: 'subscription_included',
        planLabel: 'Pro',
        limitsAvailable: true,
        limits: [{ kind: 'session', label: 'Session', utilization: 61, resetsAt: new Date(Date.now() + 3_600_000).toISOString(), scopeLabel: null }],
        note: null,
        capturedAt: new Date().toISOString(),
      },
    ],
  }),
  useRunTraces: () => ({ data: state.traces }),
  useMessageContext: () => ({ data: state.context, isLoading: false }),
  useRunEvents: () => ({ data: state.events }),
  useThreadSearch: () => ({ data: state.search, isLoading: false, isError: false }),
  useRuns: () => ({ data: [] }),
  useTicketWorkProducts: () => ({ data: [], isLoading: false }),
  useTicketFor: () => ({ data: undefined }),
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
  useTicketDocumentById: () => ({ data: undefined, isLoading: false, isError: true }),
  // VS-398: the Plan modal's own hooks — the modal itself is closed in every test here, so these
  // never actually run, but they must exist or mounting ChatPage (which always renders PlanModal)
  // throws on the first hook call.
  useStartOrResumePlan: () => ({ mutate: vi.fn() }),
  usePlan: () => ({ data: undefined }),
  useRoles: () => ({ data: [] }),
  usePatchPlanDraft: () => ({ mutate: vi.fn() }),
  useRemovePlanDraft: () => ({ mutate: vi.fn() }),
  useSubmitPlan: () => ({ mutate: vi.fn(), isPending: false }),
  useDiscardPlan: () => ({ mutate: vi.fn() }),
}));

const { V2ChatPage } = await import('../v2/ChatPage');

function message(over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'm1',
    threadId: 't1',
    direction: 'outbound',
    authorKind: 'agent',
    authorId: 'weaver1',
    runId: null,
    projectId: null,
    replyToMessageId: null,
    replyToExcerpt: null,
    body: 'Hello',
    parts: [],
    externalMessageId: null,
    deliveryStatus: 'sent',
    createdAt: '2026-09-13T09:00:00.000Z',
    ...over,
  };
}

function trace(runId: string, over: Partial<RunTrace> = {}): RunTrace {
  return {
    runId,
    status: 'succeeded',
    agentId: 'weaver1',
    createdAt: '2026-09-13T09:00:00.000Z',
    startedAt: '2026-09-13T09:00:00.000Z',
    finishedAt: '2026-09-13T09:00:34.000Z',
    durationMs: 34_000,
    toolCalls: 7,
    files: 0,
    errors: 0,
    texts: 2,
    events: 10,
    summary: null,
    model: 'sonnet',
    usage: { inputTokens: 10_000, outputTokens: 8_400, cachedInputTokens: 0, basis: 'reported' },
    ...over,
  };
}

function question(over: Partial<Decision> = {}): Decision {
  return {
    id: 'd1',
    workspaceId: 'ws1',
    ticketId: null,
    projectId: null,
    kind: 'question',
    owner: 'human',
    askedByAgentId: 'weaver1',
    askedInRunId: null,
    title: 'Approve now',
    context: '',
    options: [{ key: 'a', label: 'Option A' }],
    inputs: [],
    allowFreeText: false,
    recommendation: null,
    status: 'open',
    answerKey: null,
    answerText: null,
    answerInputs: null,
    answeredByKind: null,
    answeredById: null,
    answeredAt: null,
    expiresAt: null,
    target: null,
    correlationKey: null,
    createdAt: '2026-09-13T09:00:00.000Z',
    weaverReviewStatus: 'unseen',
    weaverReviewedAt: null,
    weaverReviewNote: null,
    weaverReviewedByAgentId: null,
    weaverReviewedHeadSha: null,
    answerAuthorKind: null,
    relayedFromMessageId: null,
    ...over,
  };
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  state.width = 900;
  state.messages = [];
  state.decisions = [];
  state.traces = [];
  state.tickets = [];
  state.workers = [
    agent({ id: 'w1', name: 'Platform Engineer #7', status: 'running', ticketId: null }),
    agent({ id: 'w2', name: 'Plugin Engineer #2', status: 'active', ticketId: null }),
  ];
  state.search = [];
  state.context = [];
  state.events = [];
  state.runEvents = [];
  state.runStreams = [];
  state.runState = 'connected';
  state.lastRun = null;
  state.answer.mockReset();
  state.post.mockReset().mockResolvedValue(undefined);
  state.go.mockReset();
});

describe('chat split geometry', () => {
  it('splits at 620px and clamps the divider to 300–560', async () => {
    const { shouldSplit, clampDivider, DIVIDER_MIN, DIVIDER_MAX } = await import('../v2/chatSplit');
    expect(shouldSplit(619)).toBe(false);
    expect(shouldSplit(620)).toBe(true);
    expect(clampDivider(100)).toBe(DIVIDER_MIN);
    expect(clampDivider(9999)).toBe(DIVIDER_MAX);
    expect(clampDivider(401.4)).toBe(401);
  });
});

describe('the V2 Chat screen', () => {
  it('gates the run stream to the focused pane (VS-199)', () => {
    state.lastRun = { id: 'r9', status: 'running' };
    const first = render(<V2ChatPage focused={false} />);
    expect(state.runStreams.at(-1)).toEqual({ id: 'r9', live: false });
    first.unmount();

    state.runStreams = [];
    render(<V2ChatPage />);
    expect(state.runStreams.at(-1)).toEqual({ id: 'r9', live: true });
  });

  it('shows no Refresh under "working" while the live stream is healthy, and one when it drops (VS-370)', async () => {
    state.lastRun = { id: 'r9', status: 'running' };
    const utils = render(<V2ChatPage />);
    await screen.findByText('working');
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();

    state.runState = 'offline';
    utils.rerender(<V2ChatPage />);
    expect(screen.getByText(/The live stream dropped/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('renders a mid-turn join’s trace lines whole, then streams a newly arrived line (VS-440)', async () => {
    const say = (id: string, seq: number, text: string): RunEvent => ({
      id, runId: 'r9', seq, ts: '2026-09-14T09:00:00.000Z', stream: 'stdout', level: 'info',
      type: 'assistant.text', payload: { text },
    });
    state.lastRun = { id: 'r9', status: 'running' };
    const utils = render(<V2ChatPage />);
    await screen.findByText('working');
    // Nothing on the wire yet: the trace is not mounted, so no history placeholder.
    expect(screen.queryByText('Nothing on the wire yet.')).toBeNull();

    // The persisted read lands: the lines already there are whole.
    state.runEvents = [
      say('e1', 1, 'Read the first file.'),
      { id: 'e2', runId: 'r9', seq: 2, ts: '2026-09-14T09:00:00.000Z', stream: 'stdout', level: 'info', type: 'tool.call', payload: { name: 'Read', callId: 'c1', target: 'src/a.ts' } } as RunEvent,
    ];
    utils.rerender(<V2ChatPage />);
    expect(screen.getByText('Read the first file.')).toBeInTheDocument();
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();

    // A line arriving while watching reveals from empty, then settles.
    state.runEvents = [...state.runEvents, say('e3', 3, 'A brand new line.')];
    utils.rerender(<V2ChatPage />);
    expect(screen.queryByText('A brand new line.')).toBeNull();
    expect(await screen.findByText('A brand new line.')).toBeInTheDocument();
  });

  it('keeps the decisions pane on desktop when nothing is waiting, and drops it below the threshold', async () => {
    state.decisions = [];
    const utils = render(<V2ChatPage />);
    expect(await screen.findByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(document.querySelector('[data-decisions-pane]')).not.toBeNull();

    state.decisions = [question()];
    utils.rerender(<V2ChatPage />);
    expect(await screen.findByText('Approve now')).toBeInTheDocument();
    expect(document.querySelector('[data-decisions-pane]')).not.toBeNull();

    state.width = 500;
    utils.rerender(<V2ChatPage />);
    expect(document.querySelector('[data-decisions-pane]')).toBeNull();
  });

  it('reports running workers, waiting decisions and the session limit in its status bar', async () => {
    state.decisions = [question(), question({ id: 'd2', title: 'Second' })];
    render(<V2ChatPage />);
    expect(screen.getByText(/1 workers running · 2 need you/)).toBeInTheDocument();
    expect(screen.getByText(/Session 61%/)).toBeInTheDocument();
  });

  it('renders a ticket id as a clickable tag, keeps a literal as code, and underlines a page link', async () => {
    state.messages = [message({ body: 'See ACME-42 and `main` and [docs](/guide)' })];
    render(<V2ChatPage />);
    await screen.findByText(/See/);

    const tag = screen.getByText('ACME-42');
    expect(tag.tagName).toBe('A');
    expect(tag.getAttribute('href')).toBe('#ticket:ACME-42');
    fireEvent.click(tag);
    expect(state.go).toHaveBeenCalledWith('/v2/w/$ws/tickets/$ticketId', { params: { ws: 'ws1', ticketId: 'ACME-42' } });

    expect(screen.getByText('main').tagName).toBe('CODE');
    expect(screen.getByText('docs').getAttribute('href')).toBe('/guide');
  });

  it('renders an open decision inline on phone and nothing in the desktop conversation', async () => {
    const card = { type: 'card', title: 'Approve the plan', body: 'Cache GET /projects', actions: [], ref: { kind: 'decision', id: 'd1' } };
    state.messages = [
      message({ id: 'm1', body: 'A real reply' }),
      message({ id: 'm2', body: 'Approve the plan\n\nCache GET /projects', parts: [card] }),
    ];
    state.decisions = [question({ id: 'd1', title: 'Approve the plan' })];

    // Phone: the pane is absent, so the card renders inline in the conversation and is answerable.
    state.width = 500;
    const phone = render(<V2ChatPage />);
    expect(await screen.findByText('A real reply')).toBeInTheDocument();
    expect(document.querySelector('[data-decisions-pane]')).toBeNull();
    expect(document.querySelectorAll('[data-chat-message]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-inline-decision-card]')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Option A/ })).toBeInTheDocument();
    // The card's prose fallback is not rendered as a message.
    expect(screen.queryByText(/Cache GET/)).toBeNull();
    phone.unmount();

    // Desktop: the pane carries the open decision; the conversation shows nothing for it.
    state.width = 900;
    render(<V2ChatPage />);
    expect(await screen.findByText('A real reply')).toBeInTheDocument();
    expect(document.querySelector('[data-decisions-pane]')).not.toBeNull();
    expect(document.querySelectorAll('[data-inline-decision-card]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-decision-note]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-chat-message]')).toHaveLength(1);
    expect(screen.getByText(/1 need you/)).toBeInTheDocument();
  });

  it('swaps the inline phone card for its note the moment it is answered', async () => {
    const card = { type: 'card', title: 'Approve the plan', body: 'Cache GET /projects', actions: [], ref: { kind: 'decision', id: 'd1' } };
    state.messages = [message({ id: 'm2', body: 'Approve the plan\n\nCache GET /projects', parts: [card] })];
    state.decisions = [question({ id: 'd1', title: 'Approve the plan' })];
    state.width = 500;
    render(<V2ChatPage />);
    expect(document.querySelectorAll('[data-inline-decision-card]')).toHaveLength(1);

    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    // In place, before any refetch: the card is gone and its note stands where it sat.
    expect(document.querySelectorAll('[data-inline-decision-card]')).toHaveLength(0);
    expect(document.querySelector('[data-decision-note]')?.textContent).toBe('You answered: Option A — Approve the plan');
  });

  it('leaves one muted note where an answered question’s card sat, at phone and desktop', async () => {
    const card = { type: 'card', title: 'Which key?', body: 'Cache GET /projects', actions: [], ref: { kind: 'decision', id: 'd1' } };
    state.messages = [
      message({ id: 'm1', body: 'A real reply' }),
      message({ id: 'm2', body: 'Which rate-limit key should we use?\n\nThe endpoint sits behind a proxy.', parts: [card] }),
    ];
    state.decisions = [
      question({
        id: 'd1',
        title: 'Which rate-limit key should we use?',
        status: 'answered',
        answerKey: 'api_key',
        options: [{ key: 'api_key', label: 'API key' }, { key: 'ip', label: 'Client IP' }],
      }),
    ];

    state.width = 500;
    const phone = render(<V2ChatPage />);
    expect(await screen.findByText('A real reply')).toBeInTheDocument();
    const phoneNotes = document.querySelectorAll('[data-decision-note]');
    expect(phoneNotes).toHaveLength(1);
    expect(phoneNotes[0]!.textContent).toBe('You answered: API key — Which rate-limit key should we use?');
    // A decision with no ticket links to Needs you.
    expect(phoneNotes[0]!.querySelector('a')?.getAttribute('href')).toBe('/v2/needs');
    // The real message is untouched; the card's prose fallback is not a message.
    expect(document.querySelectorAll('[data-chat-message]')).toHaveLength(1);
    expect(screen.queryByText(/endpoint sits behind/)).toBeNull();
    phone.unmount();

    state.width = 900;
    render(<V2ChatPage />);
    expect(await screen.findByText('A real reply')).toBeInTheDocument();
    const desktopNotes = document.querySelectorAll('[data-decision-note]');
    expect(desktopNotes).toHaveLength(1);
    expect(desktopNotes[0]!.textContent).toBe('You answered: API key — Which rate-limit key should we use?');
    expect(document.querySelectorAll('[data-chat-message]')).toHaveLength(1);
  });

  it('reads “You decided” for an answered approval, using the option label', async () => {
    const card = { type: 'card', title: 'Approve merge', body: 'PR #2 is green.', actions: [], ref: { kind: 'decision', id: 'd1' } };
    state.messages = [message({ id: 'm2', body: 'Approve merge\n\nPR #2 is green.', parts: [card] })];
    state.decisions = [
      question({
        id: 'd1',
        kind: 'merge_approval',
        title: 'Approve the merge for VS-360',
        status: 'answered',
        answerKey: 'approve',
        options: [{ key: 'approve', label: 'Approve merge' }],
      }),
    ];
    state.width = 500;
    render(<V2ChatPage />);
    const note = document.querySelector('[data-decision-note]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe('You decided: Approve merge — Approve the merge for VS-360');
  });

  it('renders a message’s attachments as rows with a glyph, byline and kind', async () => {
    state.messages = [
      message({
        body: 'files attached',
        parts: [
          { type: 'attachment', id: 'a1', filename: 'shot.png', mediaType: 'image/png', byteSize: 1200 },
          { type: 'attachment', id: 'a2', filename: 'notes.txt', mediaType: 'text/plain', byteSize: 10 },
        ],
      }),
    ];
    render(<V2ChatPage />);
    await screen.findByText('shot.png');
    expect(document.querySelector('img[alt="shot.png"]')).not.toBeNull();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText('image')).toBeInTheDocument();
  });

  it('shows a message’s time, tokens and the collapsed summary line, with no avatar', async () => {
    state.messages = [message({ id: 'm1', runId: 'r1', body: 'Done.' })];
    state.traces = [trace('r1')];
    render(<V2ChatPage />);
    await screen.findByText('Done.');
    const summary = document.querySelector('[data-chat-summary]') as HTMLElement;
    expect(summary).toHaveTextContent(/weaver did/);
    expect(summary).toHaveTextContent(/7 tool calls/);
    expect(summary).toHaveTextContent(/18\.4k tok/);
    const meta = document.querySelector('[data-chat-message]') as HTMLElement;
    expect(meta.textContent).toMatch(/\d{2}:\d{2}/);
    expect(document.querySelector('[data-avatar]')).toBeNull();
  });

  it('answers a decision in the pane through the shared answer mutation', async () => {
    state.decisions = [question()];
    render(<V2ChatPage />);
    fireEvent.click(await screen.findByRole('radio', { name: /Option A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(state.answer).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1', key: 'a' }), expect.anything());
  });

  it('surfaces a rejected decision answer in the pane', async () => {
    state.decisions = [question()];
    state.answer.mockImplementation((_payload: unknown, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(new Error('The decision changed on the daemon.'));
    });
    render(<V2ChatPage />);
    fireEvent.click(await screen.findByRole('radio', { name: /Option A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(await screen.findByText('The decision changed on the daemon.')).toBeInTheDocument();
    expect(document.querySelector('[data-answer-error]')).not.toBeNull();
  });

  it('keeps the unsent draft across unmount and remount of the screen', async () => {
    state.messages = [message({ body: 'Hello' })];
    const first = render(<V2ChatPage />);
    await screen.findByText('Hello', { exact: false });
    const box = screen.getByLabelText('Message the weaver');
    fireEvent.change(box, { target: { value: 'half typed message' } });
    expect(box).toHaveValue('half typed message');
    first.unmount();

    render(<V2ChatPage />);
    await screen.findByText('Hello', { exact: false });
    await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue('half typed message'));
  });

  it('jumps the conversation to a chosen search result', async () => {
    state.search = [{ messageId: 'm9', authorKind: 'agent', authorId: 'weaver1', createdAt: '2026-09-13T08:00:00.000Z', snippet: 'a \u0002match\u0003 here' }];
    state.context = [message({ id: 'm9', body: 'the found message' })];
    render(<V2ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search this conversation' }));
    fireEvent.change(await screen.findByLabelText('Search messages'), { target: { value: 'match' } });
    fireEvent.click(screen.getByRole('button', { name: /the found message|match/i }));
    expect(await screen.findByText('Jumped to a message in the conversation')).toBeInTheDocument();
  });

  it('renders a turn’s dispatched tickets as chips and the live workers with no message as a row (VS-412)', async () => {
    state.messages = [message({ id: 'm1', runId: 'r1', body: 'Filed two tickets.' })];
    state.traces = [trace('r1')];
    state.tickets = [
      ticket({ id: 'tk1', identifier: 'VS-1', title: 'Fix the flaky test', createdRunId: 'r1', workerId: 'w1', assigneeRoleId: 'r1', status: 'in_progress', createdAt: '2026-09-13T09:00:01.000Z' }),
      ticket({ id: 'tk2', identifier: 'VS-2', title: 'Follow-up', createdRunId: 'r1', workerId: null, assigneeRoleId: 'r1', status: 'done', createdAt: '2026-09-13T09:00:02.000Z' }),
    ];
    state.workers = [
      agent({ id: 'w1', name: 'Platform Engineer #7', status: 'running', ticketId: 'tk1', createdAt: '2026-09-13T09:00:01.000Z' }),
      agent({ id: 'w9', name: 'Plugin Engineer #2', status: 'active', ticketId: null, createdAt: '2026-09-13T09:00:00.000Z' }),
    ];
    const utils = render(<V2ChatPage />);
    await screen.findByText('Filed two tickets.');

    // Under the reply: one chip per dispatch, in the order the view model filed them.
    const chips = document.querySelectorAll('[data-v2-dispatch-chip]');
    expect(chips).toHaveLength(2);
    expect(chips[0]!.textContent).toContain('VS-1');
    expect(chips[0]!.textContent).toContain('Platform Engineer #7');
    expect(chips[0]!.textContent).toContain('working');
    expect(chips[1]!.textContent).toContain('VS-2');
    expect(chips[1]!.textContent).toContain('Follow-up');
    expect(chips[1]!.textContent).toContain('done');

    // A chip with a worker opens the worker; one filed before a worker exists opens the ticket.
    fireEvent.click(chips[0]!);
    expect(state.go).toHaveBeenCalledWith('/v2/w/$ws/workers/$workerId', { params: { ws: 'ws1', workerId: 'w1' } });
    fireEvent.click(chips[1]!);
    expect(state.go).toHaveBeenCalledWith('/v2/w/$ws/tickets/$ticketId', { params: { ws: 'ws1', ticketId: 'VS-2' } });

    // The live worker no message accounts for sits in its own row, glyph and name.
    const row = document.querySelector('[data-v2-live-worker-row]');
    expect(row).not.toBeNull();
    const workerChip = row!.querySelector('[data-v2-worker-chip]');
    expect(workerChip?.textContent).toContain('Plugin Engineer #2');
    expect(workerChip?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('idle');

    // Live, without a reload: the query's next value re-renders the chip's state in place —
    // working → idle when the worker goes between turns.
    state.workers = [
      agent({ id: 'w1', name: 'Platform Engineer #7', status: 'active', ticketId: 'tk1', createdAt: '2026-09-13T09:00:01.000Z' }),
      state.workers[1]!,
    ];
    utils.rerender(<V2ChatPage />);
    await waitFor(() => expect(document.querySelectorAll('[data-v2-dispatch-chip]')[0]!.textContent).toContain('idle'));
  });

  it('streams a new weaver reply in, but never re-animates what was already on screen (VS-425)', async () => {
    state.messages = [message({ id: 'm1', body: 'History line', createdAt: '2026-09-13T09:00:00.000Z' })];
    const { rerender } = render(<V2ChatPage />);
    // What the chat opened on is history, so it is whole on the first render — no reveal.
    expect(screen.getByText('History line')).toBeInTheDocument();

    state.messages = [
      state.messages[0]!,
      message({ id: 'm2', body: 'A brand new reply', createdAt: '2026-09-13T09:00:05.000Z' }),
    ];
    rerender(<V2ChatPage />);

    // The new reply reveals from empty, so its finished text is not on screen the frame it lands...
    expect(screen.queryByText('A brand new reply')).toBeNull();
    // ...and it arrives shortly after, with the history line never having changed.
    expect(await screen.findByText('A brand new reply')).toBeInTheDocument();
    expect(screen.getByText('History line')).toBeInTheDocument();
  });
});
