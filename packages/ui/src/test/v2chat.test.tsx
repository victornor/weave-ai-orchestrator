/**
 * VS-349: the V2 Chat screen — the split conversation/decisions layout and its collapse threshold,
 * the status bar's figures, message metadata and the collapsed summary line, inline ticket reference
 * tags, attachment rows, answering a decision in the pane, the kept search, and the draft that
 * survives remounting the screen.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Decision, RunTrace, ThreadMessage, Ticket } from '@weave-ai/shared';

const state = vi.hoisted(() => ({
  width: 900,
  messages: [] as ThreadMessage[],
  decisions: [] as Decision[],
  traces: [] as RunTrace[],
  tickets: [] as Ticket[],
  search: [] as Array<{ messageId: string; authorKind: string; authorId: string | null; createdAt: string; snippet: string }>,
  context: [] as ThreadMessage[],
  events: [] as unknown[],
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
vi.mock('../api/runStream', () => ({
  useRunEventStream: () => ({ events: [], status: { state: 'connected' }, retryNow: vi.fn() }),
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
  useDecisions: () => ({ data: state.decisions, isSuccess: true }),
  useAnswerDecision: () => ({ mutate: state.answer, isPending: false }),
  useWorkers: () => ({ data: [{ id: 'w1', status: 'running' }, { id: 'w2', status: 'idle' }] }),
  useProjects: () => ({ data: [{ id: 'p1', workspaceId: 'ws1', slug: 'web', name: 'web' }] }),
  useTickets: () => ({ data: state.tickets }),
  useWeaver: () => ({ data: { agent: { id: 'weaver1', runtimeId: 'claude' }, lastRun: null } }),
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
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
  useTicketDocumentById: () => ({ data: undefined, isLoading: false, isError: true }),
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
  state.search = [];
  state.context = [];
  state.events = [];
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
});
