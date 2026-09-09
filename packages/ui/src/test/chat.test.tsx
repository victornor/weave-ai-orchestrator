import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Decision, Project, RunEvent, RunTrace, RuntimeAccount, ThreadMessage, Ticket, WorkspaceEvent } from '@agent-conductor/shared';
import { agent, decision, project, ticket } from './factories';
import { projectColorVar } from '../lib/projectColor';
import { enqueue } from '../lib/queue';
import { clearChatScroll, readChatScroll, writeChatScroll } from '../lib/chatScroll';
import { clearHiddenCache } from '../lib/hiddenDecisions';
import { writeShowSilentTurns } from '../lib/chatPrefs';
import { writeDecisionHeight } from '../lib/decisionHeight';
import { resizeObserved } from './resizeObserver';
import { installVisualViewport, removeVisualViewport } from './visualViewport';

const bus = vi.hoisted(() => ({ handlers: new Set<(e: WorkspaceEvent) => void>() }));
const state = vi.hoisted(() => ({
  conductor: { agent: { id: 'ag_conductor', runtimeId: 'claude' }, lastRun: null as { id: string; status: string } | null },
  accounts: [] as RuntimeAccount[],
  runtimes: [{ id: 'claude', capabilities: { contextCompactionAt: 0.92 } }] as Array<{ id: string; capabilities: Record<string, unknown> }>,
  models: [{ id: 'claude-opus-5', contextWindowTokens: 200_000 }] as Array<{ id: string; contextWindowTokens?: number }>,
  messages: [] as ThreadMessage[],
  /** False while the history query is disabled or still fetching: `data` is undefined, not empty. */
  messagesLoaded: true,
  hasOlder: false,
  isLoadingOlder: false,
  loadOlder: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  persisted: [] as RunEvent[],
  traces: [] as RunTrace[],
  traceQuery: null as Record<string, unknown> | null,
  /** Every run whose events were asked for, so "loaded on demand" is testable rather than assumed. */
  eventRequests: [] as string[],
  tickets: [] as Ticket[],
  workers: [] as Agent[],
  ticketQuery: null as Record<string, unknown> | null,
  workerQuery: null as Record<string, unknown> | null,
  projects: [] as Project[],
  posted: [] as Array<Record<string, unknown>>,
  /** Set to make the next `usePostThreadMessage` mutate reject instead of succeeding. */
  postError: null as Error | null,
  /** When set, `mutateAsync` waits on this before recording the post — in-flight send tests. */
  postDeferred: null as Promise<void> | null,
  connection: 'connected' as string,
  decisions: [] as Decision[],
  decisionQuery: null as Record<string, unknown> | null,
  answer: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  toasts: [] as Array<Record<string, unknown>>,
  ws: 'ws1',
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('../api/context', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    useWs: () => state.ws,
    useConnection: () => ({ state: state.connection, capturedAt: null, lastSeq: 0, attempts: 0 }),
    useWorkspaceEvents: (fn: (e: WorkspaceEvent) => void) => {
      const ref = useRef(fn);
      ref.current = fn;
      useEffect(() => {
        const h = (e: WorkspaceEvent): void => ref.current(e);
        bus.handlers.add(h);
        return () => { bus.handlers.delete(h); };
      }, []);
    },
  };
});

vi.mock('../api/hooks', () => ({
  ACCOUNTS_REFRESH_MS: 300_000,
  useConductor: () => ({ data: state.conductor }),
  useUsageAccounts: () => ({ data: state.accounts }),
  useSyncUsageAccounts: () => ({ mutate: vi.fn(), isPending: false }),
  useRuntimes: () => ({ data: state.runtimes }),
  useRuntimeModels: () => ({ data: state.models }),
  useRunEvents: (id: string) => { if (id) state.eventRequests.push(id); return { data: id ? state.persisted : [] }; },
  useRunTraces: (p: Record<string, unknown>) => { state.traceQuery = p; return { data: state.traces }; },
  useThreads: () => ({ data: [{ id: 'th_1' }], isSuccess: true }),
  useCreateThread: () => ({ mutate: vi.fn(), isPending: false, data: null }),
  useThreadMessages: () => ({
    data: state.messagesLoaded ? state.messages : undefined, isLoading: false, isError: false, refetch: vi.fn(),
    hasOlder: state.hasOlder, isLoadingOlder: state.isLoadingOlder, loadOlder: state.loadOlder,
  }),
  usePostThreadMessage: () => ({
    mutate: (v: Record<string, unknown>, opts?: { onError?: (e: Error) => void }) => {
      if (state.postError) opts?.onError?.(state.postError);
      else state.posted.push(v);
    },
    mutateAsync: (v: Record<string, unknown>) => {
      if (state.postError) return Promise.reject(state.postError);
      const hold = state.postDeferred;
      if (hold) return hold.then(() => { state.posted.push(v); });
      state.posted.push(v);
      return Promise.resolve(undefined);
    },
  }),
  useDecisions: (p: Record<string, unknown>) => { state.decisionQuery = p; return { data: state.decisions }; },
  useAnswerDecision: () => ({ mutate: state.answer, isPending: false }),
  useTickets: (p: Record<string, unknown>) => { state.ticketQuery = p; return { data: state.tickets }; },
  useWorkers: (p: Record<string, unknown>) => { state.workerQuery = p; return { data: state.workers }; },
  useProjects: () => ({ data: state.projects, isSuccess: true }),
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
}));

vi.mock('../app/link', () => ({ useGo: () => state.go }));
vi.mock('../components/Toast', () => ({
  useToast: () => ({ push: (t: Record<string, unknown>) => { state.toasts.push(t); return 't1'; }, dismiss: vi.fn() }),
}));
vi.mock('../lib/queue', () => ({ enqueue: vi.fn(), useQueueCount: () => 0 }));

const { ChatRoute } = await import('../routes/Chat');

class FakeEventSource {
  static open: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(m: MessageEvent<string>) => void>>();
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.open.push(this); }
  addEventListener(type: string, fn: (m: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void { this.closed = true; }
  emit(event: RunEvent): void {
    for (const fn of this.listeners.get(event.type) ?? []) fn({ data: JSON.stringify(event) } as MessageEvent<string>);
  }
  connect(): void { this.onopen?.(); }
  fail(): void { this.onerror?.(); }
}

function ev(over: Partial<RunEvent> & Pick<RunEvent, 'id' | 'seq' | 'type'>): RunEvent {
  return { runId: 'run_1', ts: '2026-09-01T09:00:00.000Z', stream: 'stdout', level: 'info', payload: {}, ...over };
}

function message(over: Partial<ThreadMessage> & Pick<ThreadMessage, 'id' | 'body'>): ThreadMessage {
  return {
    threadId: 'th_1', direction: 'outbound', authorKind: 'agent', authorId: 'ag_conductor', runId: 'run_1', projectId: null,
    replyToMessageId: null, replyToExcerpt: null,
    parts: [], externalMessageId: null, deliveryStatus: 'delivered', createdAt: '2026-09-01T09:00:00.000Z', ...over,
  };
}

/** The whole rendered message — bubble, quote, project tag and timestamp — around a piece of its text. */
function messageAround(text: string): HTMLElement {
  return screen.getByText(text).closest('.group') as HTMLElement;
}

function withoutKey(v: Record<string, unknown>): Record<string, unknown> {
  const { idempotencyKey: _k, ...rest } = v;
  return rest;
}

const emit = (e: Partial<WorkspaceEvent> & Pick<WorkspaceEvent, 'type' | 'entityId'>): void => {
  act(() => {
    for (const h of bus.handlers) h({ seq: 1, workspaceId: 'ws1', entityType: 'run', payload: {}, createdAt: '', ...e } as WorkspaceEvent);
  });
};
const stream = (): FakeEventSource => FakeEventSource.open[FakeEventSource.open.length - 1]!;
const live = (): FakeEventSource[] => FakeEventSource.open.filter((s) => !s.closed);

function runTrace(over: Partial<RunTrace> & Pick<RunTrace, 'runId'>): RunTrace {
  return {
    status: 'succeeded', agentId: 'ag_conductor', createdAt: '2026-09-01T09:00:00.000Z',
    startedAt: '2026-09-01T09:00:00.000Z', finishedAt: '2026-09-01T09:00:12.000Z', durationMs: 12000,
    toolCalls: 3, files: 1, errors: 0, texts: 2, events: 9, summary: null, ...over,
  };
}

beforeEach(() => {
  bus.handlers.clear();
  FakeEventSource.open = [];
  state.conductor = { agent: { id: 'ag_conductor', runtimeId: 'claude' }, lastRun: null };
  state.accounts = [];
  state.runtimes = [{ id: 'claude', capabilities: { contextCompactionAt: 0.92 } }];
  state.models = [{ id: 'claude-opus-5', contextWindowTokens: 200_000 }];
  state.messages = [];
  state.messagesLoaded = true;
  state.hasOlder = false;
  state.isLoadingOlder = false;
  state.loadOlder = vi.fn();
  state.persisted = [];
  state.traces = [];
  state.traceQuery = null;
  state.eventRequests = [];
  state.tickets = [];
  state.workers = [];
  state.ticketQuery = null;
  state.workerQuery = null;
  state.projects = [project({ id: 'p1', name: 'API' })];
  state.posted = [];
  state.postError = null;
  state.postDeferred = null;
  state.connection = 'connected';
  vi.mocked(enqueue).mockClear();
  state.decisions = [];
  state.decisionQuery = null;
  state.answer = vi.fn();
  state.toasts = [];
  state.ws = 'ws1';
  state.go = vi.fn();
  // Hidden decisions are a device preference in localStorage behind a module-level cache; one
  // test's hidden card must not open the next test with an empty pinned area.
  localStorage.clear();
  try { sessionStorage.clear(); } catch { /* no store in this environment */ }
  clearHiddenCache();
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.clearAllMocks());

describe('ChatRoute live turn', () => {
  it('shows nothing live while the conductor is idle', () => {
    render(<ChatRoute />);
    expect(screen.queryByLabelText('Conductor is working')).not.toBeInTheDocument();
    expect(FakeEventSource.open).toHaveLength(0);
  });

  it('starts streaming when a conductor run starts, and stops when it finishes', () => {
    render(<ChatRoute />);
    emit({ type: 'run.started', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });

    expect(screen.getByLabelText('Conductor is working')).toBeInTheDocument();
    expect(stream().url).toBe('/api/w/ws1/runs/run_1/events/stream');

    act(() => { stream().emit(ev({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Reading the briefing.' } })); });
    expect(screen.getByText('Reading the briefing.')).toBeInTheDocument();

    // The stream is closed as soon as the turn ends; what it produced is held until the row that
    // replaces it is on screen (VS-74), so the bottom of the list is never empty in between.
    emit({ type: 'run.finished', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });
    expect(live()).toHaveLength(0);
    expect(screen.getByText('Reading the briefing.')).toBeInTheDocument();
  });

  it('ignores a run belonging to a worker', () => {
    render(<ChatRoute />);
    emit({ type: 'run.started', entityId: 'run_worker', payload: { agentId: 'ag_worker' } });
    expect(screen.queryByLabelText('Conductor is working')).not.toBeInTheDocument();
    expect(FakeEventSource.open).toHaveLength(0);
  });

  it('resumes a turn already in flight when the chat loads', () => {
    state.conductor.lastRun = { id: 'run_live', status: 'running' };
    state.persisted = [ev({ id: 'p1', seq: 1, type: 'assistant.text', payload: { text: 'Already working on it.' } })];

    render(<ChatRoute />);
    expect(screen.getByLabelText('Conductor is working')).toBeInTheDocument();
    expect(screen.getByText('Already working on it.')).toBeInTheDocument();
    expect(stream().url).toBe('/api/w/ws1/runs/run_live/events/stream');

    act(() => { stream().emit(ev({ id: 'e2', seq: 2, type: 'assistant.text', payload: { text: ' Nearly done.' } })); });
    expect(screen.getByText('Already working on it. Nearly done.')).toBeInTheDocument();
  });

  it('does not resume a run that already finished', () => {
    state.conductor.lastRun = { id: 'run_old', status: 'succeeded' };
    render(<ChatRoute />);
    expect(screen.queryByLabelText('Conductor is working')).not.toBeInTheDocument();
    expect(FakeEventSource.open).toHaveLength(0);
  });

  it('renders a tool call with its name, arguments and result', () => {
    render(<ChatRoute />);
    emit({ type: 'run.started', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });

    act(() => { stream().emit(ev({ id: 'e1', seq: 1, type: 'tool.call', payload: { id: 'tu_1', name: 'ac_briefing', input: { query: 'what is everyone doing' } } })); });
    expect(screen.getByText('ac_briefing')).toBeInTheDocument();
    expect(screen.getByText('what is everyone doing')).toBeInTheDocument();

    act(() => { stream().emit(ev({ id: 'e2', seq: 2, type: 'tool.result', payload: { id: 'tu_1', name: 'ac_briefing', content: '3 workers running' } })); });
    // The result is collapsed behind the call it belongs to, not a second block.
    const toggle = screen.getByRole('button', { expanded: false });
    act(() => { toggle.click(); });
    expect(screen.getByText('3 workers running')).toBeInTheDocument();
  });

  it('shows the reply once: the thread message renders, the ac_human_send call does not', () => {
    const reply = 'Filed the ticket and put Ana on it.';
    state.messages = [message({ id: 'm1', body: reply })];
    render(<ChatRoute />);
    emit({ type: 'run.started', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });

    act(() => {
      stream().emit(ev({ id: 'e1', seq: 1, type: 'tool.call', payload: { id: 'tu_1', name: 'ac_human_send', input: { body: reply } } }));
      stream().emit(ev({ id: 'e2', seq: 2, type: 'tool.result', payload: { id: 'tu_1', name: 'ac_human_send', content: 'delivered' } }));
    });

    expect(screen.queryByText('ac_human_send')).not.toBeInTheDocument();
    expect(screen.getAllByText(reply)).toHaveLength(1);
  });

  it('shows a connection notice when the run stream drops, and it clears on reconnect without duplicating the transcript', () => {
    vi.useFakeTimers();
    try {
      render(<ChatRoute />);
      emit({ type: 'run.started', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });
      act(() => { stream().connect(); });
      act(() => { stream().emit(ev({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Reading the briefing.' } })); });
      expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();

      const dropped = stream();
      act(() => { dropped.fail(); });
      expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
      expect(screen.getByText('Reading the briefing.')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(500); });
      act(() => { stream().connect(); });
      expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();

      act(() => { stream().emit(ev({ id: 'e2', seq: 2, type: 'assistant.text', payload: { text: ' Nearly done.' } })); });
      expect(screen.getAllByText(/Reading the briefing\./)).toHaveLength(1);
      expect(screen.getByText('Reading the briefing. Nearly done.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the human retry the run stream immediately from the notice', () => {
    render(<ChatRoute />);
    emit({ type: 'run.started', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });
    act(() => { stream().connect(); });

    const dropped = stream();
    act(() => { dropped.fail(); });
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    expect(live()).toHaveLength(0);

    act(() => { screen.getByRole('button', { name: 'Retry now' }).click(); });
    expect(live()).toHaveLength(1);
  });

  it('renders the notice inside the scrolling list, never over the composer or the bottom bar', () => {
    render(<ChatRoute />);
    emit({ type: 'run.started', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });
    act(() => { stream().connect(); });
    act(() => { stream().fail(); });

    const notice = screen.getByText('Reconnecting…');
    // The scrolling message list (`PageBody`, `.ac-scroll`) is where the streaming output lives; a
    // notice inside it is carried along by ordinary document flow and cannot sit over the composer
    // or the phone bottom bar, which are laid out after it, outside the scroll region.
    const scrollBody = notice.closest('.ac-scroll');
    expect(scrollBody).not.toBeNull();
    expect(notice.closest('[aria-label="Conductor is working"]')).not.toBeNull();

    const composer = screen.getByPlaceholderText('Message the conductor…');
    expect(scrollBody!.contains(composer)).toBe(false);
  });
});

describe('ChatRoute message formatting', () => {
  const mine = (body: string): ThreadMessage =>
    message({ id: 'm1', body, direction: 'inbound', authorKind: 'human', authorId: 'victor', runId: null });

  it('keeps the line breaks of a message the human typed', () => {
    state.messages = [mine('first line\nsecond line\n\n\nlast paragraph')];
    const { container } = render(<ChatRoute />);

    const paras = container.querySelectorAll('.ac-prose p');
    expect(paras).toHaveLength(2);
    expect(paras[0]!.innerHTML).toBe('first line<br>second line');
    expect(paras[1]!.textContent).toBe('last paragraph');
  });

  it('renders a list the human typed as a list', () => {
    state.messages = [mine('do these:\n\n- one\n- two')];
    const { container } = render(<ChatRoute />);

    expect([...container.querySelectorAll('.ac-prose li')].map((li) => li.textContent)).toEqual(['one', 'two']);
  });

  it('renders a code fence the human typed verbatim', () => {
    state.messages = [mine('run it:\n\n```\npnpm test\npnpm lint\n```')];
    const { container } = render(<ChatRoute />);

    const pre = container.querySelector('.ac-prose pre code');
    expect(pre?.textContent).toBe('pnpm test\npnpm lint');
    expect(pre?.innerHTML).not.toContain('<br>');
  });

  it('renders the human and the conductor sides the same way', () => {
    const body = 'about TST-1\nsecond line';
    state.messages = [mine(body), message({ id: 'm2', body })];
    const { container } = render(<ChatRoute />);

    const rendered = [...container.querySelectorAll('.ac-prose')].map((el) => el.innerHTML);
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toBe(rendered[1]);
    expect(rendered[0]).toContain('href="#ticket:TST-1"');
    expect(rendered[0]).toContain('<br>');
  });

  it('leaves the quote of a replied-to message a plain clamped excerpt', () => {
    state.messages = [{ ...mine('yes, do it'), replyToMessageId: 'm0', replyToExcerpt: 'Shall I file it?\nIt is ready.' }];
    const { container } = render(<ChatRoute />);

    const quote = container.querySelector('.line-clamp-2')!;
    expect(quote.textContent).toBe('Shall I file it?\nIt is ready.');
    expect(quote.innerHTML).not.toContain('<br>');
    expect(quote.closest('.ac-prose')).toBeNull();
  });

  it('renders a titled https link as a compact button, not the URL', () => {
    state.messages = [message({
      id: 'm2',
      body: 'Opened it.\n\n[GitHub pull request 130](https://github.com/acme/repo/pull/130)',
    })];
    const { container } = render(<ChatRoute />);

    const prose = container.querySelector('.ac-prose');
    expect(prose).toHaveClass('ac-chat-prose');
    const link = screen.getByRole('link', { name: 'GitHub pull request 130' });
    expect(link).toHaveAttribute('href', 'https://github.com/acme/repo/pull/130');
    expect(link).toHaveAttribute('target', '_blank');
    expect(prose?.textContent).not.toContain('https://github.com/acme/repo/pull/130');
  });

  it('renders several titled https links, and drops a javascript: target', () => {
    state.messages = [message({
      id: 'm2',
      body: '[GitHub pull request 130](https://github.com/acme/repo/pull/130) [Diff](https://github.com/acme/repo/pull/130/files) [nope](javascript:alert(1))',
    })];
    render(<ChatRoute />);

    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://github.com/acme/repo/pull/130',
      'https://github.com/acme/repo/pull/130/files',
    ]);
    expect(screen.getByRole('link', { name: 'GitHub pull request 130' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Diff' })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('javascript:');
  });
});


describe('ChatRoute dispatch labels', () => {
  /** True when `a` comes before `b` in the rendered document. */
  const precedes = (a: Element, b: Element): boolean =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  const dispatch = (over: Partial<Ticket> = {}): Ticket =>
    ticket({ createdRunId: 'run_1', assigneeRoleId: 'r1', workerId: null, ...over });

  const label = (identifier: string): HTMLElement =>
    screen.getByRole('button', { name: new RegExp(`^${identifier}:`) });

  it('asks for terminal tickets and retired workers, so a finished dispatch still reaches it', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    state.tickets = [dispatch({ id: 'tk_1', identifier: 'TST-1', status: 'done' })];
    state.workers = [agent({ id: 'w1', ticketId: 'tk_1', name: 'Backend Engineer #1', status: 'retired' })];

    render(<ChatRoute />);
    expect(state.ticketQuery).toMatchObject({ includeTerminal: true });
    expect(state.workerQuery).toMatchObject({ includeRetired: true });
    expect(state.workerQuery).not.toHaveProperty('status');
    expect(label('TST-1')).toBeInTheDocument();
  });

  it('renders the label directly after the message whose turn filed it', () => {
    state.messages = [
      message({ id: 'm0', body: 'Before the dispatch.', runId: 'run_0' }),
      message({ id: 'm1', body: 'Filed it and put Ana on it.' }),
      message({ id: 'm2', body: 'Anything else?', runId: 'run_2' }),
    ];
    state.tickets = [dispatch({ id: 'tk_1', identifier: 'TST-1' })];
    state.workers = [agent({ id: 'w1', ticketId: 'tk_1', name: 'Backend Engineer #1', status: 'running' })];

    render(<ChatRoute />);
    const anchor = screen.getByText('Filed it and put Ana on it.');
    const next = screen.getByText('Anything else?');
    expect(precedes(anchor, label('TST-1'))).toBe(true);
    expect(precedes(label('TST-1'), next)).toBe(true);
    expect(screen.getByText('working')).toBeInTheDocument();
  });

  it('keeps its position when later messages arrive', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    state.tickets = [dispatch({ id: 'tk_1', identifier: 'TST-1' })];
    state.workers = [agent({ id: 'w1', ticketId: 'tk_1', status: 'running' })];

    const { rerender } = render(<ChatRoute />);
    state.messages = [
      ...state.messages,
      message({ id: 'm2', body: 'And this one too?', direction: 'inbound', authorKind: 'human', runId: null }),
      message({ id: 'm3', body: 'Filed that as well.', runId: 'run_2' }),
    ];
    state.tickets = [...state.tickets, dispatch({ id: 'tk_2', identifier: 'TST-2', createdRunId: 'run_2', createdAt: '2026-09-01T10:00:00.000Z' })];
    rerender(<ChatRoute />);

    // The first label did not slide to the bottom: it is still between its own message and the next.
    expect(precedes(screen.getByText('Filed it.'), label('TST-1'))).toBe(true);
    expect(precedes(label('TST-1'), screen.getByText('And this one too?'))).toBe(true);
    expect(precedes(screen.getByText('Filed that as well.'), label('TST-2'))).toBe(true);
  });

  it('stays in place and switches to the outcome when the work ends', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    state.tickets = [dispatch({ id: 'tk_1', identifier: 'TST-1', status: 'in_progress' })];
    state.workers = [agent({ id: 'w1', ticketId: 'tk_1', status: 'running' })];

    const { rerender } = render(<ChatRoute />);
    expect(screen.getByText('working')).toBeInTheDocument();

    state.tickets = [dispatch({ id: 'tk_1', identifier: 'TST-1', status: 'done' })];
    state.workers = [agent({ id: 'w1', ticketId: 'tk_1', status: 'retired' })];
    rerender(<ChatRoute />);

    expect(screen.queryByText('working')).not.toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(precedes(screen.getByText('Filed it.'), label('TST-1'))).toBe(true);
  });

  it('shows a failed dispatch as failed', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    state.tickets = [dispatch({ id: 'tk_1', identifier: 'TST-1', status: 'cancelled' })];
    state.workers = [agent({ id: 'w1', ticketId: 'tk_1', status: 'retired' })];

    render(<ChatRoute />);
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('gives every dispatch from one turn its own label, in the order they were filed', () => {
    state.messages = [message({ id: 'm1', body: 'Filed both.' })];
    state.tickets = [
      dispatch({ id: 'tk_2', identifier: 'TST-2', createdAt: '2026-09-01T09:00:02.000Z' }),
      dispatch({ id: 'tk_1', identifier: 'TST-1', createdAt: '2026-09-01T09:00:01.000Z' }),
    ];

    render(<ChatRoute />);
    expect(precedes(label('TST-1'), label('TST-2'))).toBe(true);
  });

  it('rebuilds the same labels from the same records on a fresh mount', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' }), message({ id: 'm2', body: 'Anything else?', runId: 'run_2' })];
    state.tickets = [dispatch({ id: 'tk_1', identifier: 'TST-1', status: 'done' })];
    state.workers = [agent({ id: 'w1', ticketId: 'tk_1', status: 'retired' })];

    const first = render(<ChatRoute />);
    const before = first.container.innerHTML;
    first.unmount();

    // A reload is a fresh mount over the same persisted rows: same label, same place, same state.
    const { container } = render(<ChatRoute />);
    expect(container.innerHTML).toBe(before);
    expect(precedes(screen.getByText('Filed it.'), label('TST-1'))).toBe(true);
    expect(precedes(label('TST-1'), screen.getByText('Anything else?'))).toBe(true);
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('shows live work no message accounts for below the conversation, and nothing when there is none', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    state.tickets = [dispatch({ id: 'tk_1', identifier: 'TST-1' })];
    state.workers = [
      agent({ id: 'w1', ticketId: 'tk_1', name: 'Backend Engineer #1', status: 'running' }),
      agent({ id: 'w2', ticketId: 'tk_loose', name: 'Backend Engineer #2', status: 'running' }),
    ];

    const { rerender } = render(<ChatRoute />);
    expect(screen.getByRole('button', { name: /Backend Engineer #2/ })).toBeInTheDocument();
    // The anchored worker is a label above, not also a chip below: it is on screen exactly once.
    const anchored = screen.getAllByRole('button', { name: /Backend Engineer #1/ });
    expect(anchored).toHaveLength(1);
    expect(anchored[0]!.getAttribute('aria-label')).toMatch(/^TST-1:/);

    state.workers = [state.workers[0]!];
    rerender(<ChatRoute />);
    expect(screen.queryByRole('button', { name: /Backend Engineer #2/ })).not.toBeInTheDocument();
  });

  it('colours a project-bound dispatch and omits the marker when the ticket has no project', () => {
    state.messages = [message({ id: 'm1', body: 'Filed both.' })];
    state.tickets = [
      dispatch({ id: 'tk_1', identifier: 'TST-1', projectId: 'p1', createdAt: '2026-09-01T09:00:01.000Z' }),
      dispatch({ id: 'tk_2', identifier: 'TST-2', projectId: null, createdAt: '2026-09-01T09:00:02.000Z' }),
    ];

    render(<ChatRoute />);
    expect(label('TST-1').querySelector('[data-project-color]')?.getAttribute('style')).toContain(projectColorVar('p1'));
    expect(label('TST-2').querySelector('[data-project-color]')).toBeNull();
  });

  it('meters the conductor\u2019s context in the header, from its last finished turn', () => {
    state.conductor = {
      agent: { id: 'ag_conductor', runtimeId: 'claude', model: 'claude-opus-5' },
      lastRun: { id: 'r1', status: 'succeeded', model: 'claude-opus-5-20260115', finishedAt: '2026-09-07T10:00:00.000Z', usage: { inputTokens: 320_119, cachedInputTokens: 667_671, outputTokens: 1_022, contextTokens: 82_000 } },
    } as unknown as typeof state.conductor;
    render(<ChatRoute />);
    // The headline is the raw count, not a fraction of a denominator that has been wrong before
    // (VS-129); the only percentage left in words is the distance to compaction.
    expect(screen.getByText('82k')).toBeInTheDocument();
    expect(screen.queryByText('41%')).not.toBeInTheDocument();
    expect(screen.getByText('· 45% to compaction')).toBeInTheDocument();
    expect(screen.getByTestId('context-meter').getAttribute('title')).toContain('82k of 200k tokens');
  });

  it('shows the bare size rather than guessing a fraction when the model is not in the runtime\u2019s list (VS-129)', () => {
    state.models = [{ id: 'sonnet' }];
    state.conductor = {
      agent: { id: 'ag_conductor', runtimeId: 'claude', model: 'claude-opus-5' },
      lastRun: { id: 'r1', status: 'succeeded', model: 'claude-opus-5', finishedAt: '2026-09-07T10:00:00.000Z', usage: { inputTokens: 320_119, cachedInputTokens: 667_671, outputTokens: 1_022, contextTokens: 82_000 } },
    } as unknown as typeof state.conductor;
    render(<ChatRoute />);
    // The size is still known even though the window is not, so the header shows it rather than
    // only the quiet reason line.
    expect(screen.getByText('82k')).toBeInTheDocument();
    expect(screen.queryByText('Context window unknown')).not.toBeInTheDocument();
    expect(screen.getByTestId('context-meter').getAttribute('title')).toContain('Context window unknown');
  });

  it('shows no context meter until the conductor has finished a turn', () => {
    render(<ChatRoute />);
    expect(screen.queryByTestId('context-meter')).not.toBeInTheDocument();
  });

  it('carries the conductor runtime\u2019s plan meter in the header, and only that runtime\u2019s', () => {
    state.accounts = [
      {
        workspaceId: 'ws1', runtimeId: 'codex', billingType: 'subscription_included', planLabel: 'pro',
        limitsAvailable: true, limits: [{ kind: 'session', label: 'Session', utilization: 90, resetsAt: null, scopeLabel: null }],
        note: null, capturedAt: new Date().toISOString(),
      },
      {
        workspaceId: 'ws1', runtimeId: 'claude', billingType: 'subscription_included', planLabel: 'max',
        limitsAvailable: true, limits: [{ kind: 'session', label: 'Session', utilization: 33, resetsAt: null, scopeLabel: null }],
        note: null, capturedAt: new Date().toISOString(),
      },
    ];
    render(<ChatRoute />);
    expect(screen.getByTestId('session-limit').getAttribute('title')).toContain('claude \u00b7 max');
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.queryByText('90%')).not.toBeInTheDocument();
  });
});

describe('project context', () => {
  const group = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Project for this message' });
  const tags = (): (string | null)[] => within(group()).getAllByRole('radio').map((r) => r.textContent);
  const active = (): string | null | undefined => within(group()).queryByRole('radio', { checked: true })?.textContent;
  const choose = (name: string): void => { fireEvent.click(within(group()).getByRole('radio', { name })); };
  const sent = async (body: string): Promise<void> => {
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: body } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(box.value).toBe(''));
  };

  beforeEach(() => {
    state.projects = [project({ id: 'p1', name: 'API' }), project({ id: 'p2', slug: 'web', name: 'Web' })];
  });

  it('offers every non-archived project plus "Auto"', () => {
    state.projects = [...state.projects, project({ id: 'p3', slug: 'old', name: 'Retired', status: 'archived' })];
    render(<ChatRoute />);
    expect(tags()).toEqual(['Auto', 'API', 'Web']);
  });

  it('offers only "Auto" in a workspace with none, and still sends', async () => {
    state.projects = [];
    render(<ChatRoute />);
    expect(tags()).toEqual(['Auto']);
    await sent('set me up');
    expect(state.posted.map(withoutKey)).toEqual([{ threadId: 'th_1', body: 'set me up', projectId: null }]);
  });

  it('keeps an archived project the thread already used, shown as the current selection', () => {
    state.projects = [...state.projects, project({ id: 'p3', slug: 'old', name: 'Retired', status: 'archived' })];
    state.messages = [message({ id: 'm1', body: 'first', direction: 'inbound', projectId: 'p3' })];
    render(<ChatRoute />);
    expect(tags()).toEqual(['Auto', 'API', 'Web', 'Retired']);
    expect(active()).toBe('Retired');
  });

  it('defaults to the project the thread last used', () => {
    state.messages = [
      message({ id: 'm1', body: 'first', direction: 'inbound', projectId: 'p1' }),
      message({ id: 'm2', body: 'reply' }),
      message({ id: 'm3', body: 'second', direction: 'inbound', projectId: 'p2' }),
    ];
    render(<ChatRoute />);
    expect(active()).toBe('Web');
  });

  it('defaults to "Auto" when the thread last used none, and on an empty thread', () => {
    state.messages = [
      message({ id: 'm1', body: 'first', direction: 'inbound', projectId: 'p1' }),
      message({ id: 'm2', body: 'second', direction: 'inbound', projectId: null }),
    ];
    const first = render(<ChatRoute />);
    expect(active()).toBe('Auto');
    first.unmount();

    state.messages = [];
    render(<ChatRoute />);
    expect(active()).toBe('Auto');
  });

  it('sends the chosen project, and nothing when "Auto" is chosen', async () => {
    render(<ChatRoute />);
    choose('Web');
    await sent('do the thing');
    expect(state.posted.map(withoutKey)).toEqual([{ threadId: 'th_1', body: 'do the thing', projectId: 'p2' }]);
  });

  it('resets the selection to Auto after sending, so the next message needs a fresh pick', async () => {
    render(<ChatRoute />);
    choose('Web');
    await sent('do the thing');
    expect(active()).toBe('Auto');

    await sent('and this too');
    expect(withoutKey(state.posted[1]!)).toMatchObject({ projectId: null });
  });

  it('resets to Auto after an offline-queued send too', async () => {
    state.connection = 'offline';
    render(<ChatRoute />);
    choose('Web');
    await sent('later then');
    expect(active()).toBe('Auto');
  });

  it('does not restore the cleared selection after a reload', async () => {
    const view = render(<ChatRoute />);
    choose('Web');
    await sent('do the thing');
    view.unmount();

    render(<ChatRoute />);
    expect(active()).toBe('Auto');
  });

  it('activating the active project tag returns to Auto rather than staying active', async () => {
    render(<ChatRoute />);
    choose('Web');
    expect(active()).toBe('Web');

    choose('Web');
    expect(active()).toBe('Auto');
    await sent('after toggling back');
    expect(withoutKey(state.posted[0]!)).toMatchObject({ projectId: null });
  });

  it('scrolls the selected tag into view when the strip mounts with a project already selected', () => {
    state.messages = [message({ id: 'm1', body: 'first', direction: 'inbound', projectId: 'p2' })];
    render(<ChatRoute />);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'nearest', inline: 'nearest' }),
    );
  });

  it('keeps the project on a message queued while offline', async () => {
    state.connection = 'offline';
    render(<ChatRoute />);
    choose('API');
    await sent('later then');

    expect(state.posted).toHaveLength(0);
    expect(vi.mocked(enqueue).mock.calls[0]?.[0]).toMatchObject({
      path: '/threads/th_1/messages',
      body: { body: 'later then', projectId: 'p1' },
    });
  });

  it('shows the project a sent message carried, and nothing when it carried none', () => {
    state.messages = [
      message({ id: 'm1', body: 'with a project', direction: 'inbound', projectId: 'p2' }),
      message({ id: 'm2', body: 'without one', direction: 'inbound', projectId: null }),
    ];
    render(<ChatRoute />);

    const withProject = messageAround('with a project');
    expect(withProject).toHaveTextContent('Web');
    const without = messageAround('without one');
    expect(without).not.toHaveTextContent('Web');
    expect(without).not.toHaveTextContent('API');
  });

  it('falls back to the raw reference when the project is gone from the list', () => {
    state.messages = [message({ id: 'm1', body: 'old message', direction: 'inbound', projectId: 'p_gone' })];
    render(<ChatRoute />);
    expect(messageAround('old message')).toHaveTextContent('p_gone');
  });
});

describe('ChatRoute sending while the daemon is unreachable', () => {
  const sent = (body: string): void => {
    const box = screen.getByLabelText('Message the conductor…');
    fireEvent.change(box, { target: { value: body } });
    fireEvent.click(screen.getByLabelText('Send'));
  };

  it('queues the message and clears the working indicator when the send fails to reach the daemon', async () => {
    const { NetworkError } = await import('../api/client');
    state.postError = new NetworkError();
    render(<ChatRoute />);

    sent('are you there?');
    await waitFor(() => expect(screen.getByLabelText('Message the conductor…')).toHaveValue(''));

    // A real network failure arrives after "working" already shows; this mock rejects
    // synchronously, so what is observable here is that the indicator never sticks around.
    expect(screen.queryByLabelText('Conductor is working')).not.toBeInTheDocument();
    expect(state.posted).toHaveLength(0);
    expect(vi.mocked(enqueue).mock.calls[0]?.[0]).toMatchObject({
      path: '/threads/th_1/messages',
      body: { body: 'are you there?' },
    });
  });

  it('tells the human rather than dropping it, when the send is refused for another reason', async () => {
    state.postError = Object.assign(new Error('body too long'), { name: 'ApiError' });
    render(<ChatRoute />);

    sent('a very long message');
    await waitFor(() => expect(state.toasts[0]).toMatchObject({ title: 'Message not sent', status: 'failed' }));

    expect(state.posted).toHaveLength(0);
    expect(vi.mocked(enqueue)).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message the conductor…')).toHaveValue('a very long message');
  });
});

describe('ChatRoute send lifecycle (VS-148)', () => {
  it('a second tap while the first send is in flight does not post twice', async () => {
    let release!: () => void;
    state.postDeferred = new Promise<void>((r) => { release = r; });
    render(<ChatRoute />);
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'once' } });
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(screen.getByLabelText('Send'));
    expect(state.posted).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText('Send')).toBeDisabled());
    release();
    await waitFor(() => expect(state.posted).toHaveLength(1));
    expect(withoutKey(state.posted[0]!)).toMatchObject({ threadId: 'th_1', body: 'once' });
    expect(state.posted[0]!.idempotencyKey).toEqual(expect.any(String));
  });

  it('a failed plain-text send keeps the text, reply reference and project pick', async () => {
    state.postError = Object.assign(new Error('body too long'), { name: 'ApiError' });
    state.projects = [project({ id: 'p1', name: 'API' }), project({ id: 'p2', slug: 'web', name: 'Web' })];
    state.messages = [message({ id: 'm1', body: 'Should I ship it behind a flag?' })];
    render(<ChatRoute />);
    fireEvent.click(screen.getByLabelText('Reply to this message'));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Project for this message' })).getByRole('radio', { name: 'Web' }));
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'yes, do it' } });
    fireEvent.click(screen.getByLabelText('Send'));

    await waitFor(() => expect(state.toasts[0]).toMatchObject({ title: 'Message not sent', status: 'failed' }));
    expect(box.value).toBe('yes, do it');
    expect(screen.getByText('Replying to the conductor')).toBeInTheDocument();
    expect(within(screen.getByRole('radiogroup', { name: 'Project for this message' })).getByRole('radio', { name: 'Web' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a successful retry after a failure clears the composer, reply and project pick', async () => {
    state.postError = Object.assign(new Error('body too long'), { name: 'ApiError' });
    state.projects = [project({ id: 'p1', name: 'API' }), project({ id: 'p2', slug: 'web', name: 'Web' })];
    state.messages = [message({ id: 'm1', body: 'Should I ship it behind a flag?' })];
    render(<ChatRoute />);
    fireEvent.click(screen.getByLabelText('Reply to this message'));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Project for this message' })).getByRole('radio', { name: 'Web' }));
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'yes, do it' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(state.toasts[0]).toMatchObject({ title: 'Message not sent' }));

    state.postError = null;
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(box.value).toBe(''));
    expect(screen.queryByText('Replying to the conductor')).not.toBeInTheDocument();
    expect(within(screen.getByRole('radiogroup', { name: 'Project for this message' })).getByRole('radio', { name: 'Web' })).toHaveAttribute('aria-checked', 'false');
    expect(withoutKey(state.posted[0]!)).toEqual({ threadId: 'th_1', body: 'yes, do it', projectId: 'p2', replyToMessageId: 'm1' });
  });
});

describe('ChatRoute attachments (VS-133)', () => {
  it('sends a pasted/browsed file with the text as one multipart request', async () => {
    render(<ChatRoute />);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Message the conductor…'), { target: { value: 'look at this' } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Send'));
      await Promise.resolve();
    });

    expect(state.posted.map(withoutKey)).toEqual([{ threadId: 'th_1', body: 'look at this', projectId: null, files: [file] }]);
  });

  it('leaves the composer populated and toasts when an attachment is rejected', async () => {
    state.postError = Object.assign(new Error('shot.png: exceeds the cap'), { name: 'ApiError' });
    render(<ChatRoute />);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'too big' } });
    fireEvent.click(screen.getByLabelText('Send'));

    await act(async () => { await Promise.resolve(); });
    expect(box.value).toBe('too big');
    expect(screen.getByText('shot.png')).toBeInTheDocument();
    expect(state.toasts[0]).toMatchObject({ title: 'Message not sent', status: 'failed' });
  });

  it('shows an image attachment as a thumbnail, and a text attachment as a download chip', () => {
    state.messages = [
      message({ id: 'm1', body: 'a screenshot', direction: 'inbound', parts: [{ type: 'attachment', id: 'att1', filename: 'shot.png', mediaType: 'image/png', byteSize: 2048 }] }),
      message({ id: 'm2', body: 'and some notes', direction: 'inbound', parts: [{ type: 'attachment', id: 'att2', filename: 'notes.txt', mediaType: 'text/plain', byteSize: 40 }] }),
    ];
    render(<ChatRoute />);

    const img = messageAround('a screenshot').querySelector('img');
    expect(img).toHaveAttribute('src', '/api/w/ws1/threads/th_1/attachments/att1');
    expect(img).toHaveAttribute('alt', 'shot.png');

    const chip = within(messageAround('and some notes')).getByText('notes.txt').closest('a');
    expect(chip).toHaveAttribute('href', '/api/w/ws1/threads/th_1/attachments/att2');
    expect(chip).toHaveAttribute('download', 'notes.txt');
  });
});

describe('ChatRoute reply reference', () => {
  const sent = async (body: string): Promise<void> => {
    const box = screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: body } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(box.value).toBe(''));
  };
  const replyControls = (): HTMLElement[] => screen.queryAllByLabelText('Reply to this message');
  /** The quote above the input, which is the one inside the composer's scope slot. */
  const quote = (): HTMLElement | null => screen.queryByText('Replying to the conductor');

  beforeEach(() => {
    state.messages = [
      message({ id: 'm1', body: 'Should I ship it behind a flag?' }),
      message({ id: 'm2', body: 'and here is an unrelated note' }),
      message({ id: 'm3', body: 'my own message', direction: 'inbound', authorKind: 'human' }),
    ];
  });

  it('offers a reply control on conductor messages and not on the human’s own', () => {
    render(<ChatRoute />);
    expect(replyControls()).toHaveLength(2);
    const mine = messageAround('my own message');
    expect(mine.querySelector('[aria-label="Reply to this message"]')).toBeNull();
  });

  it('offers no reply control on a thread with no conductor messages, and still sends', async () => {
    state.messages = [message({ id: 'm3', body: 'only mine', direction: 'inbound', authorKind: 'human' })];
    render(<ChatRoute />);
    expect(replyControls()).toHaveLength(0);
    await sent('still works');
    expect(state.posted.map(withoutKey)).toEqual([{ threadId: 'th_1', body: 'still works', projectId: null }]);
  });

  it('quotes the chosen message above the input', () => {
    render(<ChatRoute />);
    expect(quote()).toBeNull();
    fireEvent.click(replyControls()[0]!);
    expect(quote()).not.toBeNull();
    expect(quote()!.parentElement!).toHaveTextContent('Should I ship it behind a flag?');
  });

  it('replaces the quote rather than accumulating when another message is chosen', async () => {
    render(<ChatRoute />);
    fireEvent.click(replyControls()[0]!);
    fireEvent.click(replyControls()[1]!);

    expect(screen.getAllByText('Replying to the conductor')).toHaveLength(1);
    expect(quote()!.parentElement!).toHaveTextContent('and here is an unrelated note');
    await sent('about that one');
    expect(state.posted[0]).toMatchObject({ replyToMessageId: 'm2' });
  });

  it('sends with no reference after the quote is dismissed', async () => {
    render(<ChatRoute />);
    fireEvent.click(replyControls()[0]!);
    fireEvent.click(screen.getByLabelText('Dismiss reply'));

    expect(quote()).toBeNull();
    await sent('never mind');
    expect(state.posted.map(withoutKey)).toEqual([{ threadId: 'th_1', body: 'never mind', projectId: null }]);
  });

  it('sends the reference, then clears the quote so the next message carries none', async () => {
    render(<ChatRoute />);
    fireEvent.click(replyControls()[0]!);
    await sent('yes, do it');

    expect(withoutKey(state.posted[0]!)).toEqual({ threadId: 'th_1', body: 'yes, do it', projectId: null, replyToMessageId: 'm1' });
    expect(quote()).toBeNull();

    await sent('and something else');
    expect(withoutKey(state.posted[1]!)).toEqual({ threadId: 'th_1', body: 'and something else', projectId: null });
  });

  it('keeps the reference on a message queued while offline, and clears the quote', async () => {
    state.connection = 'offline';
    render(<ChatRoute />);
    fireEvent.click(replyControls()[0]!);
    await sent('later then');

    expect(state.posted).toHaveLength(0);
    expect(vi.mocked(enqueue).mock.calls[0]?.[0]).toMatchObject({
      path: '/threads/th_1/messages',
      body: { body: 'later then', replyToMessageId: 'm1' },
    });
    expect(quote()).toBeNull();
  });

  it('shows the quote on a sent message, and nothing on one that carried none', () => {
    state.messages = [
      message({ id: 'm1', body: 'Should I ship it behind a flag?' }),
      message({ id: 'm2', body: 'yes, do it', direction: 'inbound', authorKind: 'human', replyToMessageId: 'm1', replyToExcerpt: 'Should I ship it behind a flag?' }),
      message({ id: 'm3', body: 'unprompted', direction: 'inbound', authorKind: 'human' }),
    ];
    render(<ChatRoute />);

    const reply = messageAround('yes, do it');
    expect(reply).toHaveTextContent('Should I ship it behind a flag?');
    const plain = messageAround('unprompted');
    expect(plain).not.toHaveTextContent('Should I ship it behind a flag?');
  });

  it('shows the quote from the message itself when the message it answers is not loaded', () => {
    // The excerpt rides on the replying message, so a paged-out referent still renders.
    state.messages = [
      message({ id: 'm9', body: 'the second one', direction: 'inbound', authorKind: 'human', replyToMessageId: 'm_gone', replyToExcerpt: 'which one did you mean?' }),
    ];
    render(<ChatRoute />);
    expect(messageAround('the second one')).toHaveTextContent('which one did you mean?');
  });
});

describe('ChatRoute decision cards', () => {
  /** True when `a` comes before `b` in the rendered document. */
  const precedes = (a: Element, b: Element): boolean =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  const asked = (over: Partial<Decision> = {}): Decision =>
    decision({
      id: 'd1', kind: 'question', ticketId: null, askedInRunId: 'run_1', title: 'File this as a ticket?',
      context: 'It is a one-line fix.', recommendation: null, target: null,
      options: [
        { key: 'file', label: 'File it', description: 'A ticket, routed to the engineer.' },
        { key: 'skip', label: 'Leave it', description: 'Nothing is filed.' },
      ],
      ...over,
    });

  it('asks for open and answered decisions, so an answered card survives in the history', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    render(<ChatRoute />);
    expect(state.decisionQuery).toMatchObject({ status: ['open', 'answered'], owner: 'human' });
  });

  it('pins an open card below the whole conversation, not where it was asked', () => {
    state.messages = [
      message({ id: 'm0', body: 'Before the question.', runId: 'run_0' }),
      message({ id: 'm1', body: 'One thing before I start.' }),
      message({ id: 'm2', body: 'Anything else?', runId: 'run_2' }),
    ];
    state.decisions = [asked()];

    render(<ChatRoute />);
    const card = screen.getByLabelText('Conductor asks: File this as a ticket?');
    // Exactly one card: pinned instead of anchored, never both.
    expect(screen.getAllByLabelText('Conductor asks: File this as a ticket?')).toHaveLength(1);
    expect(screen.getByLabelText('Open decisions')).toContainElement(card);
    expect(precedes(screen.getByText('Anything else?'), card)).toBe(true);
    expect(screen.getByRole('radio', { name: /File it/ })).toBeInTheDocument();
    expect(screen.getByText('Write your own…')).toBeInTheDocument();
  });

  it('keeps the card pinned below the newest message as the conversation grows', () => {
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked()];

    const { rerender } = render(<ChatRoute />);
    state.messages = [
      ...state.messages,
      message({ id: 'm2', body: 'Go ahead.', direction: 'inbound', authorKind: 'human', runId: null }),
      message({ id: 'm3', body: 'Done.', runId: 'run_2' }),
    ];
    rerender(<ChatRoute />);

    const card = screen.getByLabelText('Conductor asks: File this as a ticket?');
    expect(precedes(screen.getByText('Go ahead.'), card)).toBe(true);
    expect(precedes(screen.getByText('Done.'), card)).toBe(true);
  });

  it('pins the area between the message list and the composer', () => {
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked()];

    render(<ChatRoute />);
    const area = screen.getByLabelText('Open decisions');
    // Outside the scrolling body — the list keeps its own scroll and its scroll-to-bottom button.
    expect(area.closest('.ac-scroll')).toBe(area);
    expect(area.contains(screen.getByText('One thing before I start.'))).toBe(false);
    expect(precedes(area, screen.getByPlaceholderText('Message the conductor…'))).toBe(true);
  });

  it('stacks several open decisions oldest first', () => {
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [
      asked({ id: 'd_new', title: 'Second question?', createdAt: '2026-09-01T09:05:00.000Z' }),
      asked({ id: 'd_old', title: 'First question?', createdAt: '2026-09-01T09:00:00.000Z' }),
    ];

    render(<ChatRoute />);
    const area = screen.getByLabelText('Open decisions');
    const cards = Array.from(area.querySelectorAll('article')).map((a) => a.getAttribute('aria-label'));
    expect(cards).toEqual(['Conductor asks: First question?', 'Conductor asks: Second question?']);
  });

  it('answers the card that was sent from the pinned area', () => {
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked({ id: 'd_a', title: 'First question?', createdAt: '2026-09-01T09:00:00.000Z' }), asked({ id: 'd_b', title: 'Second question?', createdAt: '2026-09-01T09:05:00.000Z' })];

    render(<ChatRoute />);
    const second = screen.getByLabelText('Conductor asks: Second question?');
    fireEvent.click(within(second).getByRole('radio', { name: /File it/ }));
    fireEvent.click(within(second).getByRole('button', { name: 'Send answer' }));
    expect(state.answer).toHaveBeenCalledWith({ id: 'd_b', key: 'file' }, expect.anything());
  });

  it('drops the card from the pinned area once it is answered, leaving the record in history', () => {
    state.messages = [
      message({ id: 'm1', body: 'One thing before I start.' }),
      message({ id: 'm2', body: 'Done.', runId: 'run_2' }),
    ];
    state.decisions = [asked()];

    const { rerender } = render(<ChatRoute />);
    expect(screen.getByLabelText('Open decisions')).toBeInTheDocument();

    // However it was answered — here, or from Needs you — the decision comes back answered.
    state.decisions = [asked({ status: 'answered', answerKey: 'file', answeredAt: '2026-09-01T09:30:00.000Z' })];
    rerender(<ChatRoute />);

    expect(screen.queryByLabelText('Open decisions')).not.toBeInTheDocument();
    const record = screen.getByLabelText('Answered: File this as a ticket?');
    expect(precedes(screen.getByText('One thing before I start.'), record)).toBe(true);
    expect(precedes(record, screen.getByText('Done.'))).toBe(true);
  });

  it('answers with the option that was selected and sent', () => {
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked()];

    render(<ChatRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    expect(state.answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(state.answer).toHaveBeenCalledWith({ id: 'd1', key: 'file' }, expect.anything());
  });

  it('reports an answer the daemon refused', () => {
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked()];
    state.answer = vi.fn((_vars: unknown, opts: { onError: (e: Error) => void }) => opts.onError(new Error('decision d1 is answered')));

    render(<ChatRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(state.toasts).toEqual([{ title: 'Could not record that answer', detail: 'decision d1 is answered', status: 'failed' }]);
  });

  it('says a stale card was superseded and offers a way to the replacement, instead of a raw error', async () => {
    const { ApiError } = await import('../api/client');
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked({ ticketId: 'tk_1' })];
    state.answer = vi.fn((_vars: unknown, opts: { onError: (e: Error) => void }) =>
      opts.onError(new ApiError(409, { code: 'wrong_status', message: 'decision d1 is superseded', details: { status: 'superseded', supersededBy: 'd2' } })));

    render(<ChatRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0]).toMatchObject({ title: 'This changed while you were looking at it', status: 'failed' });
    expect(state.go).not.toHaveBeenCalled();
    (state.toasts[0]!.action as { run: () => void }).run();
    expect(state.go).toHaveBeenCalledWith('/w/$ws/tickets/$ticketId', { params: { ws: 'ws1', ticketId: 'tk_1' } });
  });

  it('never treats a stale answer as reaching the decision that replaced it', async () => {
    const { ApiError } = await import('../api/client');
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked({ ticketId: 'tk_1' })];
    state.answer = vi.fn((_vars: unknown, opts: { onError: (e: Error) => void }) =>
      opts.onError(new ApiError(409, { code: 'wrong_status', message: 'decision d1 is superseded', details: { status: 'superseded', supersededBy: 'd2' } })));

    render(<ChatRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(state.answer).toHaveBeenCalledTimes(1);
    expect(state.answer).toHaveBeenCalledWith({ id: 'd1', key: 'file' }, expect.anything());
  });

  it('shows an answered-elsewhere refusal with no replacement action', async () => {
    const { ApiError } = await import('../api/client');
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked({ ticketId: 'tk_1' })];
    state.answer = vi.fn((_vars: unknown, opts: { onError: (e: Error) => void }) =>
      opts.onError(new ApiError(409, { code: 'wrong_status', message: 'decision d1 is answered', details: { status: 'answered' } })));

    render(<ChatRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(state.toasts).toEqual([{
      title: 'Already answered',
      detail: 'Someone else answered this before your response reached the daemon.',
      status: 'failed',
      action: undefined,
    }]);
  });

  it('queues a non-secret answer while offline, the same way Needs You does', () => {
    state.connection = 'offline';
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked()];

    render(<ChatRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(state.answer).not.toHaveBeenCalled();
    expect(vi.mocked(enqueue).mock.calls[0]?.[0]).toMatchObject({
      kind: 'decision',
      path: '/decisions/d1/answer',
      body: { key: 'file' },
    });
  });

  it('never queues a secret-carrying answer while offline, and tells the human it was not sent', () => {
    state.connection = 'offline';
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked({
      options: [],
      inputs: [{ key: 'token', label: 'Read-only token', type: 'secret', required: true, secretName: 'CF_READONLY_TOKEN' }],
    })];

    render(<ChatRoute />);
    fireEvent.change(screen.getByLabelText(/Read-only token/), { target: { value: 'cf-not-a-real-token-0000000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(state.answer).not.toHaveBeenCalled();
    expect(vi.mocked(enqueue)).not.toHaveBeenCalled();
    expect(state.toasts.at(-1)).toMatchObject({ title: 'Not sent', status: 'failed' });
  });

  it('queues a non-secret answer when the send fails to reach the daemon', async () => {
    const { NetworkError } = await import('../api/client');
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked()];
    state.answer = vi.fn((_vars: unknown, opts: { onError: (e: Error) => void }) => opts.onError(new NetworkError()));

    render(<ChatRoute />);
    fireEvent.click(screen.getByRole('radio', { name: /File it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(vi.mocked(enqueue).mock.calls[0]?.[0]).toMatchObject({
      kind: 'decision',
      path: '/decisions/d1/answer',
      body: { key: 'file' },
    });
  });

  it('never queues a secret-carrying answer even when the send fails to reach the daemon', async () => {
    const { NetworkError } = await import('../api/client');
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked({
      options: [],
      inputs: [{ key: 'token', label: 'Read-only token', type: 'secret', required: true, secretName: 'CF_READONLY_TOKEN' }],
    })];
    state.answer = vi.fn((_vars: unknown, opts: { onError: (e: Error) => void }) => opts.onError(new NetworkError()));

    render(<ChatRoute />);
    fireEvent.change(screen.getByLabelText(/Read-only token/), { target: { value: 'cf-not-a-real-token-0000000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(vi.mocked(enqueue)).not.toHaveBeenCalled();
    expect(state.toasts.at(-1)).toMatchObject({ title: 'Not sent', status: 'failed' });
  });

  it('renders an answered decision in place, inert, showing what was chosen', () => {
    state.messages = [
      message({ id: 'm1', body: 'One thing before I start.' }),
      message({ id: 'm2', body: 'Done.', runId: 'run_2' }),
    ];
    state.decisions = [asked({ status: 'answered', answerKey: 'file', answeredAt: '2026-09-01T09:30:00.000Z' })];

    render(<ChatRoute />);
    const card = screen.getByLabelText('Answered: File this as a ticket?');
    expect(precedes(screen.getByText('One thing before I start.'), card)).toBe(true);
    expect(precedes(card, screen.getByText('Done.'))).toBe(true);
    expect(screen.getByText('File it')).toBeInTheDocument();
    expect(within(card).queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send answer' })).not.toBeInTheDocument();
  });

  it('rebuilds the same cards in the same places on a fresh mount', () => {
    state.messages = [
      message({ id: 'm1', body: 'One thing before I start.' }),
      message({ id: 'm2', body: 'Done.', runId: 'run_2' }),
    ];
    state.decisions = [asked({ status: 'answered', answerKey: 'file' })];

    const first = render(<ChatRoute />).container.innerHTML;
    cleanup();
    expect(render(<ChatRoute />).container.innerHTML).toBe(first);
  });

  it('pins an unanchored open decision too, and drops an answered one it cannot place', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    const workerQuestion = asked({ id: 'd_worker', title: 'Which storage?', askedInRunId: 'run_worker' });
    const oldAnswer = asked({ id: 'd_old', title: 'Ship on Friday?', askedInRunId: 'run_worker', status: 'answered', answerKey: 'file' });
    state.decisions = [workerQuestion, oldAnswer];

    render(<ChatRoute />);
    const card = screen.getByLabelText('Worker question: Which storage?');
    expect(screen.getByLabelText('Open decisions')).toContainElement(card);
    expect(screen.queryByLabelText('Answered: Ship on Friday?')).not.toBeInTheDocument();
  });

  it('counts only the decisions still waiting', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    state.decisions = [asked(), asked({ id: 'd2', status: 'answered', answerKey: 'file' })];
    render(<ChatRoute />);
    expect(screen.getByText(/1 need you/)).toBeInTheDocument();
  });

  it('tags a conductor-filed plan and shows its summary, and tags neither a human-filed ticket (VS-146)', () => {
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.tickets = [
      ticket({ id: 'tk_agent', identifier: 'VS-145', createdByKind: 'agent', summary: 'Filed after a false stuck-worker alarm.' }),
      ticket({ id: 'tk_human', identifier: 'VS-99', createdByKind: 'human', summary: 'Captain asked for this.' }),
    ];
    state.decisions = [
      decision({
        id: 'd_agent', kind: 'plan_approval', ticketId: 'tk_agent', title: 'Plan: close the false alarm',
        askedInRunId: 'run_1',
      }),
    ];
    const { unmount } = render(<ChatRoute />);
    const agentCard = screen.getByLabelText(/Plan: close the false alarm/);
    expect(within(agentCard).getByText('Filed by conductor')).toBeInTheDocument();
    expect(within(agentCard).getByText('Filed after a false stuck-worker alarm.')).toBeInTheDocument();
    expect(agentCard.querySelector(':scope > div:last-of-type')).toHaveClass('p-3');
    unmount();

    state.decisions = [
      decision({
        id: 'd_human', kind: 'plan_approval', ticketId: 'tk_human', title: 'Plan: captain asked',
        askedInRunId: 'run_1',
      }),
    ];
    render(<ChatRoute />);
    const humanCard = screen.getByLabelText(/Plan: captain asked/);
    expect(within(humanCard).queryByText('Filed by conductor')).not.toBeInTheDocument();
    expect(within(humanCard).queryByText('Captain asked for this.')).toBeInTheDocument();
  });

  it('shows no provenance tag on a card that concerns no ticket (VS-146)', () => {
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked({ ticketId: null })];
    render(<ChatRoute />);
    expect(screen.queryByText('Filed by conductor')).not.toBeInTheDocument();
  });
});

describe('ChatRoute hiding a pinned decision', () => {
  const asked = (over: Partial<Decision> = {}): Decision =>
    decision({
      id: 'd1', kind: 'question', ticketId: 'tk_1', askedInRunId: 'run_1', title: 'File this as a ticket?',
      context: 'It is a one-line fix.', recommendation: null, target: null,
      options: [
        { key: 'file', label: 'File it', description: 'A ticket, routed to the engineer.' },
        { key: 'skip', label: 'Leave it', description: 'Nothing is filed.' },
      ],
      ...over,
    });

  /** The card for a decision, whichever header the chat decided it deserves. */
  const cardFor = (title: string): HTMLElement | null => screen.queryByLabelText(new RegExp(`: ${title.replace('?', '\\?')}$`));
  const hideIt = (): void => { fireEvent.click(screen.getByRole('button', { name: /Hide from chat/ })); };

  it('takes the card off the pinned area without answering the decision', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    state.decisions = [asked()];
    render(<ChatRoute />);

    hideIt();
    expect(cardFor('File this as a ticket?')).not.toBeInTheDocument();
    expect(state.answer).not.toHaveBeenCalled();
    // Still open, so the header still counts it and Needs you still has it.
    expect(screen.getByText(/1 need you/)).toBeInTheDocument();
  });

  it('says how many are hidden and puts every one of them back with one press', () => {
    state.decisions = [
      asked({ id: 'd_a', title: 'First question?', createdAt: '2026-09-01T09:00:00.000Z' }),
      asked({ id: 'd_b', title: 'Second question?', createdAt: '2026-09-01T09:05:00.000Z' }),
    ];
    render(<ChatRoute />);

    for (const title of ['First question?', 'Second question?']) {
      fireEvent.click(within(cardFor(title)!).getByRole('button', { name: /Hide from chat/ }));
    }
    const restore = screen.getByRole('button', { name: /2 hidden from chat/ });
    expect(cardFor('First question?')).not.toBeInTheDocument();

    fireEvent.click(restore);
    expect(cardFor('First question?')).toBeInTheDocument();
    expect(cardFor('Second question?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hidden from chat/ })).toBeNull();
  });

  it('is still hidden after a reload', () => {
    state.decisions = [asked()];
    const { unmount } = render(<ChatRoute />);
    hideIt();
    unmount();

    // A reload keeps localStorage and loses the module cache, which is what a fresh tab has.
    clearHiddenCache();
    render(<ChatRoute />);
    expect(cardFor('File this as a ticket?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 hidden from chat/ })).toBeInTheDocument();
  });

  it('pins it again when a comment lands on its ticket', () => {
    state.decisions = [asked()];
    render(<ChatRoute />);
    hideIt();

    // A comment on some other ticket leaves it hidden.
    emit({ type: 'ticket.comment', entityType: 'ticket', entityId: 'tk_other' });
    expect(cardFor('File this as a ticket?')).not.toBeInTheDocument();

    emit({ type: 'ticket.comment', entityType: 'ticket', entityId: 'tk_1' });
    expect(cardFor('File this as a ticket?')).toBeInTheDocument();
  });

  it('pins it again when the decision itself is edited', () => {
    state.decisions = [asked()];
    const { rerender } = render(<ChatRoute />);
    hideIt();

    state.decisions = [asked({ context: 'Actually it touches three files.' })];
    rerender(<ChatRoute />);
    expect(cardFor('File this as a ticket?')).toBeInTheDocument();
  });

  it('offers no hide control on the inert record of an answered decision', () => {
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    state.decisions = [asked({ status: 'answered', answerKey: 'file', answeredAt: '2026-09-01T09:30:00.000Z' })];
    render(<ChatRoute />);
    expect(cardFor('File this as a ticket?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hide from chat/ })).toBeNull();
  });
});

describe('ChatRoute follow the bottom', () => {
  const HEIGHT = 1000;
  const CLIENT = 300;
  const BOTTOM = HEIGHT - CLIENT;

  // jsdom has no layout: scrollHeight and clientHeight are always 0 and scrollTop never moves. These
  // stand in for the geometry the follow measures, so scrolling can be observed at all.
  function scrollable(el: HTMLElement): (top: number) => void {
    let top = 0;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => HEIGHT });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => CLIENT });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
    return (to: number) => {
      top = to;
      fireEvent.scroll(el);
    };
  }

  const list = (c: HTMLElement): HTMLElement => c.querySelector('.ac-scroll') as HTMLElement;
  const scrolls = (): number =>
    (window.HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
  const button = (): HTMLElement | null => screen.queryByRole('button', { name: /^Scroll to bottom/ });

  it('keeps the list pinned to the bottom while the human is there', () => {
    const { container, rerender } = render(<ChatRoute />);
    scrollable(list(container));
    const before = scrolls();

    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    rerender(<ChatRoute />);

    expect(scrolls()).toBeGreaterThan(before);
    expect(button()).not.toBeInTheDocument();
  });

  it('stops following once the human scrolls up, and says content arrived', () => {
    const { container, rerender } = render(<ChatRoute />);
    const to = scrollable(list(container));
    to(BOTTOM);
    to(40);

    expect(button()).toBeInTheDocument();
    expect(button()!.getAttribute('aria-label')).toBe('Scroll to bottom');

    const before = scrolls();
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    rerender(<ChatRoute />);

    // The message rendered, but the viewport stayed where they left it.
    expect(screen.getByText('Filed it.')).toBeInTheDocument();
    expect(scrolls()).toBe(before);
    expect(button()!.getAttribute('aria-label')).toBe('Scroll to bottom — new messages');
  });

  it('leaves a scrolled-up viewport alone while a turn streams', () => {
    const { container } = render(<ChatRoute />);
    const to = scrollable(list(container));
    emit({ type: 'run.started', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });
    to(BOTTOM);
    to(40);

    const before = scrolls();
    act(() => { stream().emit(ev({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Reading the briefing.' } })); });

    expect(screen.getByText('Reading the briefing.')).toBeInTheDocument();
    expect(scrolls()).toBe(before);
    expect(button()).toBeInTheDocument();
  });

  it('returns to the bottom on the button and follows again', () => {
    const { container, rerender } = render(<ChatRoute />);
    const to = scrollable(list(container));
    to(BOTTOM);
    to(40);

    const before = scrolls();
    fireEvent.click(button()!);
    expect(scrolls()).toBe(before + 1);
    expect(button()).not.toBeInTheDocument();

    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    rerender(<ChatRoute />);
    expect(scrolls()).toBe(before + 2);
  });

  it('follows again when they scroll back to the bottom by hand', () => {
    const { container, rerender } = render(<ChatRoute />);
    const to = scrollable(list(container));
    to(BOTTOM);
    to(40);
    expect(button()).toBeInTheDocument();

    to(BOTTOM);
    expect(button()).not.toBeInTheDocument();

    const before = scrolls();
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    rerender(<ChatRoute />);
    expect(scrolls()).toBe(before + 1);
  });
});

describe('ChatRoute on a phone with the keyboard open', () => {
  const HEIGHT = 1000;
  const OPEN = 300;
  /** What is left of the list once the keyboard has taken the bottom half of the screen. */
  const SHRUNK = 120;

  // jsdom performs no layout, so the two things a keyboard does — the list getting shorter without
  // its content changing, and the visual viewport shrinking without any element changing at all —
  // both have to be staged. Neither of them is a change to what the follow watches, which is the
  // whole point: only a geometry listener can notice them.
  function scrollable(el: HTMLElement): { to: (top: number) => void; shrink: () => void } {
    let top = 0;
    let client = OPEN;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => HEIGHT });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => client });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
    return {
      to: (v: number) => { top = v; fireEvent.scroll(el); },
      shrink: () => { client = SHRUNK; act(() => resizeObserved()); },
    };
  }

  const list = (c: HTMLElement): HTMLElement => c.querySelector('.ac-scroll') as HTMLElement;
  const scrolls = (): number =>
    (window.HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
  const button = (): HTMLElement | null => screen.queryByRole('button', { name: /^Scroll to bottom/ });

  let viewport: ReturnType<typeof installVisualViewport>;
  beforeEach(() => { viewport = installVisualViewport(800); });
  afterEach(removeVisualViewport);

  it('follows the newest message when the keyboard takes half the list away', () => {
    const { container } = render(<ChatRoute />);
    const { to, shrink } = scrollable(list(container));
    to(HEIGHT - OPEN);

    const before = scrolls();
    shrink();

    expect(scrolls()).toBe(before + 1);
  });

  it('does not offer the scroll-to-bottom button merely because the list got shorter', () => {
    const { container } = render(<ChatRoute />);
    const { to, shrink } = scrollable(list(container));
    to(HEIGHT - OPEN);
    shrink();
    // The shrink leaves the offset 180px from the bottom without the human having moved anything.
    fireEvent.scroll(list(container));

    expect(button()).not.toBeInTheDocument();
  });

  it('leaves a scrolled-up list exactly where it is when the keyboard opens', () => {
    const { container } = render(<ChatRoute />);
    const { to, shrink } = scrollable(list(container));
    to(HEIGHT - OPEN);
    to(40);

    const before = scrolls();
    shrink();

    expect(scrolls()).toBe(before);
    expect(button()).toBeInTheDocument();
  });

  it('re-pins on a visual-viewport resize, which changes no element at all', () => {
    const { container } = render(<ChatRoute />);
    const { to } = scrollable(list(container));
    to(HEIGHT - OPEN);

    const before = scrolls();
    act(() => viewport.keyboard(500));

    expect(scrolls()).toBe(before + 1);
  });

  it('keeps following the stream while the keyboard is open', () => {
    const { container } = render(<ChatRoute />);
    const { to, shrink } = scrollable(list(container));
    to(HEIGHT - OPEN);
    shrink();
    emit({ type: 'run.started', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });

    const before = scrolls();
    act(() => { stream().emit(ev({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Reading the briefing.' } })); });

    expect(screen.getByText('Reading the briefing.')).toBeInTheDocument();
    expect(scrolls()).toBeGreaterThan(before);
    expect(button()).not.toBeInTheDocument();
  });
});

describe('ChatRoute history paging', () => {
  const CLIENT = 300;

  // jsdom has no layout. Same stand-in as the follow suite above, but the height grows: a page
  // arriving at the top is exactly the case where the list gets taller than it was.
  function scrollable(el: HTMLElement, height: number): { to: (top: number) => void; grow: (h: number) => void } {
    let top = 0;
    let scrollHeight = height;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => CLIENT });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
    return {
      to: (v: number) => { top = v; fireEvent.scroll(el); },
      grow: (h: number) => { scrollHeight = h; },
    };
  }

  const list = (c: HTMLElement): HTMLElement => c.querySelector('.ac-scroll') as HTMLElement;
  const calls = (): unknown[][] => (window.HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const lastScroll = (): unknown => calls()[calls().length - 1]?.[0];

  it('opens on the newest page at the bottom, without animating there', () => {
    state.messages = [message({ id: 'm1', body: 'Oldest loaded.' }), message({ id: 'm2', body: 'Newest.' })];

    render(<ChatRoute />);

    // The jump is instant; only the follow that comes after it animates.
    expect(lastScroll()).toEqual({ behavior: 'auto', block: 'end' });
  });

  it('animates the follow once the list is open', () => {
    state.messages = [message({ id: 'm1', body: 'Newest.' })];
    const { rerender } = render(<ChatRoute />);

    state.messages = [...state.messages, message({ id: 'm2', body: 'And one more.' })];
    rerender(<ChatRoute />);

    expect(lastScroll()).toEqual({ behavior: 'smooth', block: 'end' });
  });

  it('asks for the page before the loaded history at the top, and holds the viewport while it arrives', () => {
    state.messages = [message({ id: 'm2', body: 'Newest.' })];
    state.hasOlder = true;

    const { container, rerender } = render(<ChatRoute />);
    const el = list(container);
    const { to, grow } = scrollable(el, 2000);

    // The human scrolls back to the top of what is loaded: 1960px above the bottom.
    to(40);
    expect(state.loadOlder).toHaveBeenCalledTimes(1);

    // The page arrives above what was on screen and makes the list 1200px taller.
    grow(3200);
    const before = calls().length;
    state.messages = [message({ id: 'm0', body: 'Older.' }), ...state.messages];
    rerender(<ChatRoute />);

    // The same content is under the eye — still 1960px above the bottom — and the follow did not
    // read the prepended page as new content at the other end.
    expect(screen.getByText('Older.')).toBeInTheDocument();
    expect(el.scrollTop).toBe(1240);
    expect(calls().length).toBe(before);
  });

  it('shows a loading row above the history only while an older page is in flight', () => {
    state.messages = [message({ id: 'm1', body: 'Newest.' })];
    const { rerender } = render(<ChatRoute />);
    expect(screen.queryByText('Loading earlier messages…')).not.toBeInTheDocument();

    state.isLoadingOlder = true;
    rerender(<ChatRoute />);
    expect(screen.getByText('Loading earlier messages…')).toBeInTheDocument();
  });

  it('stops asking once the loaded history reaches the beginning of the thread', () => {
    state.messages = [message({ id: 'm1', body: 'The first thing I ever said.' })];
    state.hasOlder = false;

    const { container } = render(<ChatRoute />);
    scrollable(list(container), 2000).to(0);

    expect(state.loadOlder).not.toHaveBeenCalled();
  });

  it('does not ask twice for the same page', () => {
    state.messages = [message({ id: 'm1', body: 'Newest.' })];
    state.hasOlder = true;
    state.isLoadingOlder = true;

    const { container } = render(<ChatRoute />);
    scrollable(list(container), 2000).to(0);

    expect(state.loadOlder).not.toHaveBeenCalled();
  });
});

/**
 * VS-63: the history query is disabled until the thread id is known, and a disabled query is idle
 * rather than fetching — so it reports `isLoading: false` with no data on the renders before there
 * is a thread. Those renders must not be taken for a loaded, empty chat.
 */
describe('ChatRoute opening position', () => {
  const calls = (): unknown[][] => (window.HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const lastScroll = (): unknown => calls()[calls().length - 1]?.[0];

  it('waits for the history and jumps to the newest message when it lands', () => {
    state.messagesLoaded = false;
    const { rerender } = render(<ChatRoute />);
    // Nothing has been positioned yet: the opening jump belongs to the first real content.
    expect(calls()).toHaveLength(0);

    state.messagesLoaded = true;
    state.messages = [message({ id: 'm1', body: 'Oldest loaded.' }), message({ id: 'm2', body: 'Newest.' })];
    rerender(<ChatRoute />);

    expect(lastScroll()).toEqual({ behavior: 'auto', block: 'end' });
    expect(screen.queryByRole('button', { name: /^Scroll to bottom/ })).not.toBeInTheDocument();
  });

  it('still animates the follow once the history has opened', () => {
    state.messagesLoaded = false;
    const { rerender } = render(<ChatRoute />);

    state.messagesLoaded = true;
    state.messages = [message({ id: 'm1', body: 'Newest.' })];
    rerender(<ChatRoute />);

    state.messages = [...state.messages, message({ id: 'm2', body: 'And one more.' })];
    rerender(<ChatRoute />);

    expect(lastScroll()).toEqual({ behavior: 'smooth', block: 'end' });
  });

  it('shows the history loading rather than an empty thread before it arrives', () => {
    state.messagesLoaded = false;
    render(<ChatRoute />);
    expect(screen.queryByText('Tell me what you need.')).not.toBeInTheDocument();
  });
});

describe('ChatRoute drafts', () => {
  const box = (): HTMLTextAreaElement => screen.getByLabelText('Message the conductor…') as HTMLTextAreaElement;
  const type = (body: string): void => { fireEvent.change(box(), { target: { value: body } }); };

  it('keeps an unsent message when the page is left, and restores it with the caret at the end', () => {
    const view = render(<ChatRoute />);
    type('half a thought about the');
    view.unmount();

    render(<ChatRoute />);
    expect(box().value).toBe('half a thought about the');
    expect(box().selectionStart).toBe('half a thought about the'.length);
    expect(box().selectionEnd).toBe('half a thought about the'.length);
  });

  it('clears the draft once the message is sent', async () => {
    const view = render(<ChatRoute />);
    type('ship it');
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(state.posted).toHaveLength(1));
    expect(box().value).toBe('');
    view.unmount();

    render(<ChatRoute />);
    expect(box().value).toBe('');
  });

  it('forgets a draft the human clears themselves', () => {
    const view = render(<ChatRoute />);
    type('never mind');
    type('');
    view.unmount();

    render(<ChatRoute />);
    expect(box().value).toBe('');
  });

  it('keeps the drafts of two workspaces apart', () => {
    const view = render(<ChatRoute />);
    type('for the first workspace');
    view.unmount();

    state.ws = 'ws2';
    const other = render(<ChatRoute />);
    expect(box().value).toBe('');
    type('for the second');
    other.unmount();

    state.ws = 'ws1';
    render(<ChatRoute />);
    expect(box().value).toBe('for the first workspace');
  });

  it('restores the reply reference and the project tag with the text', async () => {
    state.projects = [project({ id: 'p1', name: 'API' }), project({ id: 'p2', slug: 'web', name: 'Web' })];
    state.messages = [message({ id: 'm1', body: 'Should I ship it behind a flag?' })];

    const group = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Project for this message' });

    const view = render(<ChatRoute />);
    fireEvent.click(screen.getByLabelText('Reply to this message'));
    fireEvent.click(within(group()).getByRole('radio', { name: 'Web' }));
    type('yes, do it');
    view.unmount();

    render(<ChatRoute />);
    expect(box().value).toBe('yes, do it');
    expect(screen.getByText('Replying to the conductor')).toBeInTheDocument();
    expect(within(group()).getByRole('radio', { name: 'Web' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(withoutKey(state.posted[0]!)).toEqual({ threadId: 'th_1', body: 'yes, do it', projectId: 'p2', replyToMessageId: 'm1' }));
  });

  it('restores what dictation transcribed before the page was left', () => {
    // Dictation writes through the same value the human types into, so a stopped mic leaves a draft.
    const view = render(<ChatRoute />);
    type('file a ticket for the login bug');
    view.unmount();

    render(<ChatRoute />);
    expect(box().value).toBe('file a ticket for the login bug');
  });
});

/**
 * VS-46: the reading position is per workspace and survives leaving the chat. The geometry goes on
 * the prototype, not on the node: the effect that restores runs inside `render()`, before a test can
 * reach the element to define anything on it.
 */
describe('ChatRoute reading position', () => {
  const HEIGHT = 1600;
  const CLIENT = 300;
  const tops = new WeakMap<HTMLElement, number>();

  beforeEach(() => {
    Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', { configurable: true, get: () => HEIGHT });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { configurable: true, get: () => CLIENT });
    Object.defineProperty(HTMLDivElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: HTMLElement) { return tops.get(this) ?? 0; },
      set(this: HTMLElement, v: number) { tops.set(this, v); },
    });
    state.messages = [message({ id: 'm1', body: 'Filed it.' })];
    clearChatScroll('ws1');
  });

  afterEach(() => {
    for (const prop of ['scrollHeight', 'clientHeight', 'scrollTop']) {
      Reflect.deleteProperty(HTMLDivElement.prototype, prop);
    }
    clearChatScroll('ws1');
  });

  const list = (c: HTMLElement): HTMLElement => c.querySelector('.ac-scroll') as HTMLElement;

  it('restores a position the human had scrolled to', () => {
    writeChatScroll('ws1', 420, false);
    const { container } = render(<ChatRoute />);
    expect(list(container).scrollTop).toBe(420);
  });

  it('leaves a chat that was at its newest message to the follow', () => {
    writeChatScroll('ws1', 980, true);
    const { container } = render(<ChatRoute />);
    // Nothing was recorded for a chat left at the bottom, so nothing is put back by hand.
    expect(list(container).scrollTop).toBe(0);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('records where the chat was left when it is closed', () => {
    const { container, unmount } = render(<ChatRoute />);
    const el = list(container);
    // The list opens at its newest message; the human scrolls up from there into the history.
    el.scrollTop = HEIGHT - CLIENT;
    fireEvent.scroll(el);
    el.scrollTop = 380;
    fireEvent.scroll(el);
    unmount();
    expect(readChatScroll('ws1')).toBe(380);
  });

  it('records nothing when the chat was left at its newest message', () => {
    const { container, unmount } = render(<ChatRoute />);
    const el = list(container);
    el.scrollTop = HEIGHT - CLIENT;
    fireEvent.scroll(el);
    unmount();
    expect(readChatScroll('ws1')).toBeNull();
  });

  it('keeps each workspace’s position apart', () => {
    const { container, unmount } = render(<ChatRoute />);
    const el = list(container);
    el.scrollTop = HEIGHT - CLIENT;
    fireEvent.scroll(el);
    el.scrollTop = 380;
    fireEvent.scroll(el);
    unmount();

    expect(readChatScroll('ws1')).toBe(380);
    expect(readChatScroll('other')).toBeNull();
  });

  it('keeps nothing from the follow’s own scrolling', () => {
    const { container, unmount } = render(<ChatRoute />);
    const el = list(container);
    // A frame of the opening jump or of a follow in flight: the list moved itself, downwards, and
    // stopped short of the bottom. That is not somewhere the human chose to be.
    el.scrollTop = 900;
    fireEvent.scroll(el);
    unmount();

    expect(readChatScroll('ws1')).toBeNull();
  });

  it('restores once the history is there, not onto the empty list before it', () => {
    writeChatScroll('ws1', 420, false);
    state.messagesLoaded = false;

    const { container, rerender } = render(<ChatRoute />);
    expect(list(container).scrollTop).toBe(0);

    state.messagesLoaded = true;
    rerender(<ChatRoute />);
    expect(list(container).scrollTop).toBe(420);
  });
});

/**
 * VS-74 (`conductor-chat/turn-work-trace`): a finished turn keeps what it did, collapsed under the
 * reply, and a turn that said nothing still leaves a row.
 */
describe('ChatRoute turn work trace', () => {
  it('keeps a collapsed summary of what a finished turn did under its reply', () => {
    state.messages = [message({ id: 'm1', body: 'Filed VS-9.', runId: 'run_1' })];
    state.traces = [runTrace({ runId: 'run_1', toolCalls: 3, files: 2, durationMs: 12000 })];

    render(<ChatRoute />);

    const trace = screen.getByRole('button', { name: 'What I did' });
    expect(trace).toHaveAttribute('aria-expanded', 'false');
    expect(trace).toHaveTextContent('3 tool calls');
    expect(trace).toHaveTextContent('2 files');
    expect(trace).toHaveTextContent('12s');
  });

  it('asks for a turn\u2019s events only once its section is expanded', () => {
    state.messages = [message({ id: 'm1', body: 'Filed VS-9.', runId: 'run_1' })];
    state.traces = [runTrace({ runId: 'run_1' })];
    state.persisted = [ev({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Reading the briefing.' } })];

    render(<ChatRoute />);
    expect(state.eventRequests).not.toContain('run_1');
    expect(screen.queryByText('Reading the briefing.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'What I did' }));

    expect(state.eventRequests).toContain('run_1');
    expect(screen.getByText('Reading the briefing.')).toBeInTheDocument();
  });

  it('remembers an expanded section for the session', () => {
    state.messages = [message({ id: 'm1', body: 'Filed VS-9.', runId: 'run_1' })];
    state.traces = [runTrace({ runId: 'run_1' })];

    const first = render(<ChatRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'What I did' }));
    expect(screen.getByRole('button', { name: 'What I did' })).toHaveAttribute('aria-expanded', 'true');
    first.unmount();

    render(<ChatRoute />);
    expect(screen.getByRole('button', { name: 'What I did' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows nothing extra for a message that cannot be linked to a run', () => {
    state.messages = [message({ id: 'm1', body: 'From elsewhere.', runId: null })];
    state.traces = [];

    render(<ChatRoute />);

    expect(screen.queryByRole('button', { name: 'What I did' })).not.toBeInTheDocument();
    expect(state.eventRequests).toEqual([]);
  });

  it('renders no section for a turn that recorded nothing', () => {
    state.messages = [message({ id: 'm1', body: 'Nothing to do.', runId: 'run_1' })];
    state.traces = [runTrace({ runId: 'run_1', toolCalls: 0, files: 0, errors: 0, texts: 0, events: 2 })];

    render(<ChatRoute />);

    expect(screen.queryByRole('button', { name: 'What I did' })).not.toBeInTheDocument();
  });

  it('carries the section on the last message of a turn that sent several', () => {
    state.messages = [
      message({ id: 'm1', body: 'One moment.', runId: 'run_1', createdAt: '2026-09-01T09:00:00.000Z' }),
      message({ id: 'm2', body: 'Filed VS-9.', runId: 'run_1', createdAt: '2026-09-01T09:00:05.000Z' }),
    ];
    state.traces = [runTrace({ runId: 'run_1' })];

    render(<ChatRoute />);

    expect(screen.getAllByRole('button', { name: 'What I did' })).toHaveLength(1);
  });

  it('asks for the runs behind the messages and for the conductor’s turns since the oldest of them', () => {
    state.messages = [
      message({ id: 'm1', body: 'a', runId: 'run_1', createdAt: '2026-09-01T09:00:00.000Z' }),
      message({ id: 'm2', body: 'b', runId: 'run_2', createdAt: '2026-09-01T09:05:00.000Z' }),
    ];

    render(<ChatRoute />);

    expect(state.traceQuery).toEqual({ ids: ['run_1', 'run_2'], agent: 'ag_conductor', since: '2026-09-01T09:00:00.000Z' });
  });
});

describe('ChatRoute turns that said nothing', () => {
  // The preference is a device setting in `localStorage`, which nothing else clears between tests.
  // Reset before rather than after: the chat is still mounted when an `afterEach` runs, and the
  // write publishes to it.
  beforeEach(() => writeShowSilentTurns(true));

  const silent = runTrace({
    runId: 'run_silent',
    createdAt: '2026-09-01T09:02:00.000Z',
    startedAt: '2026-09-01T09:02:00.000Z',
    finishedAt: '2026-09-01T09:02:30.000Z',
    summary: 'filed VS-9',
  });

  it('renders a compact row for a finished turn that produced no message', () => {
    state.messages = [message({ id: 'm1', body: 'Earlier.', runId: 'run_1', createdAt: '2026-09-01T09:00:00.000Z' })];
    state.traces = [runTrace({ runId: 'run_1' }), silent];

    render(<ChatRoute />);

    const row = screen.getByRole('button', { name: /^What the conductor did at / });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row).toHaveTextContent('3 tool calls');
    expect(screen.getByText('filed VS-9')).toBeInTheDocument();
  });

  it('orders the row against the messages by when the turn ran', () => {
    state.messages = [
      message({ id: 'm1', body: 'Earlier.', runId: 'run_1', createdAt: '2026-09-01T09:00:00.000Z' }),
      message({ id: 'm2', body: 'Later.', runId: 'run_2', createdAt: '2026-09-01T09:10:00.000Z' }),
    ];
    state.traces = [silent];

    const { container } = render(<ChatRoute />);

    const text = (container.textContent ?? '');
    expect(text.indexOf('Earlier.')).toBeLessThan(text.indexOf('filed VS-9'));
    expect(text.indexOf('filed VS-9')).toBeLessThan(text.indexOf('Later.'));
  });

  it('renders no row for a turn that is still running', () => {
    state.messages = [message({ id: 'm1', body: 'Earlier.', runId: 'run_1' })];
    state.traces = [runTrace({ runId: 'run_2', status: 'running', finishedAt: null, durationMs: null })];

    render(<ChatRoute />);

    expect(screen.queryByRole('button', { name: /^What the conductor did at / })).not.toBeInTheDocument();
  });

  it('hides the rows when the device preference is off, keeping the sections on replies', () => {
    state.messages = [message({ id: 'm1', body: 'Earlier.', runId: 'run_1' })];
    state.traces = [runTrace({ runId: 'run_1' }), silent];
    writeShowSilentTurns(false);

    render(<ChatRoute />);

    expect(screen.queryByRole('button', { name: /^What the conductor did at / })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What I did' })).toBeInTheDocument();
  });
});

describe('ChatRoute live turn folding into its trace', () => {
  it('holds the finished turn on screen until the reply that replaces it arrives', () => {
    const { rerender } = render(<ChatRoute />);
    emit({ type: 'run.started', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });
    act(() => { stream().emit(ev({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Reading the briefing.' } })); });

    emit({ type: 'run.finished', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });
    expect(screen.getByLabelText('Conductor is working')).toBeInTheDocument();

    // The thread and the traces catch up; only then does the live block let go.
    state.messages = [message({ id: 'm1', body: 'The briefing is clear.', runId: 'run_1' })];
    state.traces = [runTrace({ runId: 'run_1' })];
    rerender(<ChatRoute />);

    expect(screen.queryByLabelText('Conductor is working')).not.toBeInTheDocument();
    expect(screen.getByText('The briefing is clear.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What I did' })).toBeInTheDocument();
  });

  it('lets go of a turn that never produces a row, rather than holding it for the session', () => {
    vi.useFakeTimers();
    try {
      render(<ChatRoute />);
      emit({ type: 'run.started', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });
      emit({ type: 'run.finished', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });
      expect(screen.getByLabelText('Conductor is working')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(5000); });

      expect(screen.queryByLabelText('Conductor is working')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ChatRoute resizable decisions area', () => {
  const asked = (over: Partial<Decision> = {}): Decision =>
    decision({
      id: 'd1', kind: 'question', ticketId: null, askedInRunId: 'run_1', title: 'File this as a ticket?',
      context: 'It is a one-line fix.', recommendation: null, target: null,
      options: [{ key: 'file', label: 'File it' }, { key: 'skip', label: 'Leave it' }],
      ...over,
    });

  /** The clamps the geometry below works out to, so a test asserts a number rather than an outcome. */
  const MIN = 144;
  const MAX = 580; // 800 (the area's bottom) - 100 (the list's top) - 120 (the strip the list keeps)

  const area = (): HTMLElement => screen.getByLabelText('Open decisions');
  const handle = (): HTMLElement => screen.getByRole('separator', { name: 'Resize the decisions area' });
  const stored = (): string | null => localStorage.getItem('conductor.decisions.height');

  /** The cap a chosen height renders as: never a fixed size, so shorter content is never padded out. */
  const capOf = (px: number): string => `min(${px}px, calc(var(--ac-app-h) * 0.75))`;

  const rect = (el: Element, top: number, height: number): void => {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }),
    });
  };

  /**
   * The layout jsdom will never perform. A 900px window: the message list starts at 100 under the
   * header, the pinned area is 200 tall and its bottom edge sits at 800 with the composer below it.
   * Without this every rect is zeros, the clamps collapse to their floor, and a drag test would pass
   * while asserting nothing.
   */
  const laidOut = (container: HTMLElement, areaHeight = 200): void => {
    rect(area(), 800 - areaHeight, areaHeight);
    rect(container.querySelector('.ac-scroll') as HTMLElement, 100, 800 - areaHeight - 100);
  };

  /** Render with one decision pinned and the geometry faked, the gauge caught up on a second pass. */
  const open = (): HTMLElement => {
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked()];
    const { container, rerender } = render(<ChatRoute />);
    laidOut(container);
    rerender(<ChatRoute />);
    return container;
  };

  it('is as tall as its contents under the app cap until the human resizes it', () => {
    open();
    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe('calc(var(--ac-app-h) * 0.45)');
    expect(stored()).toBeNull();
  });

  it('offers the top edge as a handle that says what it resizes', () => {
    open();
    expect(area()).toContainElement(handle());
    expect(handle()).toHaveAttribute('aria-orientation', 'horizontal');
    expect(handle()).toHaveAttribute('tabindex', '0');
    // A focusable separator has to report where it is and what it is bounded by.
    expect(handle()).toHaveAttribute('aria-valuenow', '200');
    expect(handle()).toHaveAttribute('aria-valuemin', String(MIN));
    expect(handle()).toHaveAttribute('aria-valuemax', String(MAX));
  });

  it('grows the area when the top edge is dragged up and shrinks it when dragged down', () => {
    open();
    fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 600 });

    // An absolute mapping: the pointer's distance from the area's bottom edge is its height.
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 400 });
    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(400));

    fireEvent.pointerMove(window, { pointerId: 1, clientY: 550 });
    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(250));

    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(stored()).toBe('250');
    expect(handle()).toHaveAttribute('aria-valuenow', '250');
  });

  it('stops at the large end, leaving the composer and a strip of the conversation on screen', () => {
    open();
    fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 600 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: -2000 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(MAX));
    expect(stored()).toBe(String(MAX));
  });

  it('stops at the small end, leaving a card heading and its actions on screen', () => {
    open();
    fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 600 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 2000 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(MIN));
    expect(stored()).toBe(String(MIN));
  });

  it('writes nothing when the handle is pressed and released without moving', () => {
    open();
    fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 600 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(area().style.height).toBe('');
    expect(stored()).toBeNull();
  });

  it('is dragged by a finger the same way', () => {
    open();
    // `touch-none` is `touch-action: none`: without it the finger scrolls the page, not the edge.
    expect(handle()).toHaveClass('touch-none');

    fireEvent.pointerDown(handle(), { pointerId: 7, pointerType: 'touch', clientY: 600 });
    fireEvent.pointerMove(window, { pointerId: 7, pointerType: 'touch', clientY: 500 });
    fireEvent.pointerUp(window, { pointerId: 7, pointerType: 'touch' });

    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(300));
  });

  it('resizes in steps from the arrow keys', () => {
    open();
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(224));
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(area().style.maxHeight).toBe(capOf(176));
    expect(stored()).toBe('176');
  });

  it('goes straight to either clamp and no further', () => {
    open();
    fireEvent.keyDown(handle(), { key: 'End' });
    expect(area().style.maxHeight).toBe(capOf(MAX));
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(area().style.maxHeight).toBe(capOf(MAX));

    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(area().style.maxHeight).toBe(capOf(MIN));
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(area().style.maxHeight).toBe(capOf(MIN));
  });

  it('leaves a key it does not handle alone', () => {
    open();
    const event = createEvent.keyDown(handle(), { key: 'PageUp' });
    fireEvent(handle(), event);

    expect(area().style.height).toBe('');
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['Enter', 'Escape'])('gives the chosen height back on %s', (key) => {
    open();
    fireEvent.keyDown(handle(), { key: 'End' });
    fireEvent.keyDown(handle(), { key });

    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe('calc(var(--ac-app-h) * 0.45)');
    expect(stored()).toBeNull();
  });

  it('gives the chosen height back on a double-click of the handle', () => {
    open();
    fireEvent.keyDown(handle(), { key: 'End' });
    fireEvent.doubleClick(handle());

    expect(area().style.height).toBe('');
    expect(stored()).toBeNull();
  });

  it('opens at the height this device chose, whatever workspace the chat is for', () => {
    // What a reload has: the key in localStorage and nothing else.
    writeDecisionHeight(350);
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked()];
    const { rerender } = render(<ChatRoute />);
    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(350));

    state.ws = 'ws2';
    rerender(<ChatRoute />);
    expect(area().style.maxHeight).toBe(capOf(350));
  });

  it('pins nothing when nothing is open, and returns at the chosen height when a card arrives', () => {
    writeDecisionHeight(350);
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    const { rerender } = render(<ChatRoute />);
    expect(screen.queryByLabelText('Open decisions')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize the decisions area' })).not.toBeInTheDocument();

    state.decisions = [asked()];
    rerender(<ChatRoute />);
    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(350));
  });

  it('caps rather than fixes the height once every card is hidden', () => {
    open();
    fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 600 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(stored()).toBe('500');

    fireEvent.click(screen.getByRole('button', { name: /Hide from chat/ }));

    expect(screen.getByRole('button', { name: /1 hidden from chat/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/File this as a ticket\?/)).not.toBeInTheDocument();
    // The chosen height is still the cap the region is bounded by — it is just no longer forced,
    // which is the only thing jsdom's styleless layout lets a test observe directly.
    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(500));
  });

  it('caps rather than fixes the height when the open content is shorter than it', () => {
    // What a reload has after a height was chosen for a screenful of cards: the number in
    // localStorage, applied to a chat that now opens with a single short card.
    writeDecisionHeight(500);
    state.messages = [message({ id: 'm1', body: 'One thing before I start.' })];
    state.decisions = [asked()];
    render(<ChatRoute />);

    expect(area()).toContainElement(screen.getByLabelText('Conductor asks: File this as a ticket?'));
    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(500));
  });

  it('restores the chosen height’s worth of content when hidden cards are shown again', () => {
    open();
    fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 600 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    fireEvent.click(screen.getByRole('button', { name: /Hide from chat/ }));
    fireEvent.click(screen.getByRole('button', { name: /1 hidden from chat/ }));

    expect(screen.getByLabelText('Conductor asks: File this as a ticket?')).toBeInTheDocument();
    expect(area().style.height).toBe('');
    expect(area().style.maxHeight).toBe(capOf(500));
  });

  it('leaves the message list following its newest message across a resize', () => {
    const container = open();
    const before = (window.HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 600 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 400 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    // The relayout the browser would perform: the list is 200px shorter than it was.
    rect(container.querySelector('.ac-scroll') as HTMLElement, 100, 300);
    act(() => resizeObserved());

    expect((window.HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before);
    expect(screen.queryByRole('button', { name: /^Scroll to bottom/ })).not.toBeInTheDocument();
  });

  it('answers nothing and hides nothing by being resized', () => {
    open();
    fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 600 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 400 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(state.answer).not.toHaveBeenCalled();
    expect(state.posted).toEqual([]);
    expect(area()).toContainElement(screen.getByLabelText('Conductor asks: File this as a ticket?'));
  });
});
