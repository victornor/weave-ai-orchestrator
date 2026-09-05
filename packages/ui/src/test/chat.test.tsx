import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Decision, Project, RunEvent, ThreadMessage, Ticket, WorkspaceEvent } from '@agent-conductor/shared';
import { agent, decision, project, ticket } from './factories';
import { enqueue } from '../lib/queue';

const bus = vi.hoisted(() => ({ handlers: new Set<(e: WorkspaceEvent) => void>() }));
const state = vi.hoisted(() => ({
  conductor: { agent: { id: 'ag_conductor' }, lastRun: null as { id: string; status: string } | null },
  messages: [] as ThreadMessage[],
  hasOlder: false,
  isLoadingOlder: false,
  loadOlder: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  persisted: [] as RunEvent[],
  tickets: [] as Ticket[],
  workers: [] as Agent[],
  ticketQuery: null as Record<string, unknown> | null,
  workerQuery: null as Record<string, unknown> | null,
  projects: [] as Project[],
  posted: [] as Array<Record<string, unknown>>,
  connection: 'connected' as string,
  decisions: [] as Decision[],
  decisionQuery: null as Record<string, unknown> | null,
  answer: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  toasts: [] as Array<Record<string, unknown>>,
  ws: 'ws1',
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
  useConductor: () => ({ data: state.conductor }),
  useRunEvents: (id: string) => ({ data: id ? state.persisted : [] }),
  useThreads: () => ({ data: [{ id: 'th_1' }], isSuccess: true }),
  useCreateThread: () => ({ mutate: vi.fn(), isPending: false, data: null }),
  useThreadMessages: () => ({
    data: state.messages, isLoading: false, isError: false, refetch: vi.fn(),
    hasOlder: state.hasOlder, isLoadingOlder: state.isLoadingOlder, loadOlder: state.loadOlder,
  }),
  usePostThreadMessage: () => ({ mutate: (v: Record<string, unknown>) => state.posted.push(v) }),
  useDecisions: (p: Record<string, unknown>) => { state.decisionQuery = p; return { data: state.decisions }; },
  useAnswerDecision: () => ({ mutate: state.answer, isPending: false }),
  useTickets: (p: Record<string, unknown>) => { state.ticketQuery = p; return { data: state.tickets }; },
  useWorkers: (p: Record<string, unknown>) => { state.workerQuery = p; return { data: state.workers }; },
  useProjects: () => ({ data: state.projects, isSuccess: true }),
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
}));

vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));
vi.mock('../components/Toast', () => ({
  useToast: () => ({ push: (t: Record<string, unknown>) => { state.toasts.push(t); return 't1'; }, dismiss: vi.fn() }),
}));
vi.mock('../lib/queue', () => ({ enqueue: vi.fn(), useQueueCount: () => 0 }));

const { ChatRoute } = await import('../routes/Chat');

class FakeEventSource {
  static open: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(m: MessageEvent<string>) => void>>();
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

const emit = (e: Partial<WorkspaceEvent> & Pick<WorkspaceEvent, 'type' | 'entityId'>): void => {
  act(() => {
    for (const h of bus.handlers) h({ seq: 1, workspaceId: 'ws1', entityType: 'run', payload: {}, createdAt: '', ...e } as WorkspaceEvent);
  });
};
const stream = (): FakeEventSource => FakeEventSource.open[FakeEventSource.open.length - 1]!;

beforeEach(() => {
  bus.handlers.clear();
  FakeEventSource.open = [];
  state.conductor = { agent: { id: 'ag_conductor' }, lastRun: null };
  state.messages = [];
  state.hasOlder = false;
  state.isLoadingOlder = false;
  state.loadOlder = vi.fn();
  state.persisted = [];
  state.tickets = [];
  state.workers = [];
  state.ticketQuery = null;
  state.workerQuery = null;
  state.projects = [project({ id: 'p1', name: 'API' })];
  state.posted = [];
  state.connection = 'connected';
  vi.mocked(enqueue).mockClear();
  state.decisions = [];
  state.decisionQuery = null;
  state.answer = vi.fn();
  state.toasts = [];
  state.ws = 'ws1';
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

    emit({ type: 'run.finished', entityId: 'run_1', payload: { agentId: 'ag_conductor' } });
    expect(screen.queryByLabelText('Conductor is working')).not.toBeInTheDocument();
    expect(screen.queryByText('Reading the briefing.')).not.toBeInTheDocument();
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
});

describe('project context', () => {
  const picker = (): HTMLSelectElement => screen.getByLabelText('Project for this message') as HTMLSelectElement;
  const sent = (body: string): void => {
    const box = screen.getByLabelText('Message the conductor…');
    fireEvent.change(box, { target: { value: body } });
    fireEvent.click(screen.getByLabelText('Send'));
  };

  beforeEach(() => {
    state.projects = [project({ id: 'p1', name: 'API' }), project({ id: 'p2', slug: 'web', name: 'Web' })];
  });

  it('offers every non-archived project plus "all projects"', () => {
    state.projects = [...state.projects, project({ id: 'p3', slug: 'old', name: 'Retired', status: 'archived' })];
    render(<ChatRoute />);
    expect([...picker().options].map((o) => o.textContent)).toEqual(['All projects', 'API', 'Web']);
  });

  it('offers only "all projects" in a workspace with none, and still sends', () => {
    state.projects = [];
    render(<ChatRoute />);
    expect([...picker().options].map((o) => o.textContent)).toEqual(['All projects']);
    sent('set me up');
    expect(state.posted).toEqual([{ threadId: 'th_1', body: 'set me up', projectId: null }]);
  });

  it('defaults to the project the thread last used', () => {
    state.messages = [
      message({ id: 'm1', body: 'first', direction: 'inbound', projectId: 'p1' }),
      message({ id: 'm2', body: 'reply' }),
      message({ id: 'm3', body: 'second', direction: 'inbound', projectId: 'p2' }),
    ];
    render(<ChatRoute />);
    expect(picker().value).toBe('p2');
  });

  it('defaults to "all projects" when the thread last used none, and on an empty thread', () => {
    state.messages = [
      message({ id: 'm1', body: 'first', direction: 'inbound', projectId: 'p1' }),
      message({ id: 'm2', body: 'second', direction: 'inbound', projectId: null }),
    ];
    const first = render(<ChatRoute />);
    expect(picker().value).toBe('');
    first.unmount();

    state.messages = [];
    render(<ChatRoute />);
    expect(picker().value).toBe('');
  });

  it('sends the chosen project, and nothing when "all projects" is chosen', () => {
    render(<ChatRoute />);
    fireEvent.change(picker(), { target: { value: 'p2' } });
    sent('do the thing');
    expect(state.posted).toEqual([{ threadId: 'th_1', body: 'do the thing', projectId: 'p2' }]);

    // The pick sticks for the next message until it is changed back.
    sent('and this too');
    expect(state.posted[1]).toMatchObject({ projectId: 'p2' });

    fireEvent.change(picker(), { target: { value: '' } });
    sent('workspace-wide');
    expect(state.posted[2]).toMatchObject({ body: 'workspace-wide', projectId: null });
  });

  it('keeps the project on a message queued while offline', () => {
    state.connection = 'offline';
    render(<ChatRoute />);
    fireEvent.change(picker(), { target: { value: 'p1' } });
    sent('later then');

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

    const withProject = screen.getByText('with a project').parentElement!.parentElement!;
    expect(withProject).toHaveTextContent('Web');
    const without = screen.getByText('without one').parentElement!.parentElement!;
    expect(without).not.toHaveTextContent('Web');
    expect(without).not.toHaveTextContent('API');
  });

  it('falls back to the raw reference when the project is gone from the list', () => {
    state.messages = [message({ id: 'm1', body: 'old message', direction: 'inbound', projectId: 'p_gone' })];
    render(<ChatRoute />);
    expect(screen.getByText('old message').parentElement!.parentElement!).toHaveTextContent('p_gone');
  });
});

describe('ChatRoute reply reference', () => {
  const sent = (body: string): void => {
    const box = screen.getByLabelText('Message the conductor…');
    fireEvent.change(box, { target: { value: body } });
    fireEvent.click(screen.getByLabelText('Send'));
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
    const mine = screen.getByText('my own message').parentElement!.parentElement!;
    expect(mine.querySelector('[aria-label="Reply to this message"]')).toBeNull();
  });

  it('offers no reply control on a thread with no conductor messages, and still sends', () => {
    state.messages = [message({ id: 'm3', body: 'only mine', direction: 'inbound', authorKind: 'human' })];
    render(<ChatRoute />);
    expect(replyControls()).toHaveLength(0);
    sent('still works');
    expect(state.posted).toEqual([{ threadId: 'th_1', body: 'still works', projectId: null }]);
  });

  it('quotes the chosen message above the input', () => {
    render(<ChatRoute />);
    expect(quote()).toBeNull();
    fireEvent.click(replyControls()[0]!);
    expect(quote()).not.toBeNull();
    expect(quote()!.parentElement!).toHaveTextContent('Should I ship it behind a flag?');
  });

  it('replaces the quote rather than accumulating when another message is chosen', () => {
    render(<ChatRoute />);
    fireEvent.click(replyControls()[0]!);
    fireEvent.click(replyControls()[1]!);

    expect(screen.getAllByText('Replying to the conductor')).toHaveLength(1);
    expect(quote()!.parentElement!).toHaveTextContent('and here is an unrelated note');
    sent('about that one');
    expect(state.posted[0]).toMatchObject({ replyToMessageId: 'm2' });
  });

  it('sends with no reference after the quote is dismissed', () => {
    render(<ChatRoute />);
    fireEvent.click(replyControls()[0]!);
    fireEvent.click(screen.getByLabelText('Dismiss reply'));

    expect(quote()).toBeNull();
    sent('never mind');
    expect(state.posted).toEqual([{ threadId: 'th_1', body: 'never mind', projectId: null }]);
  });

  it('sends the reference, then clears the quote so the next message carries none', () => {
    render(<ChatRoute />);
    fireEvent.click(replyControls()[0]!);
    sent('yes, do it');

    expect(state.posted[0]).toEqual({ threadId: 'th_1', body: 'yes, do it', projectId: null, replyToMessageId: 'm1' });
    expect(quote()).toBeNull();

    sent('and something else');
    expect(state.posted[1]).toEqual({ threadId: 'th_1', body: 'and something else', projectId: null });
  });

  it('keeps the reference on a message queued while offline, and clears the quote', () => {
    state.connection = 'offline';
    render(<ChatRoute />);
    fireEvent.click(replyControls()[0]!);
    sent('later then');

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

    const reply = screen.getByText('yes, do it').parentElement!.parentElement!;
    expect(reply).toHaveTextContent('Should I ship it behind a flag?');
    const plain = screen.getByText('unprompted').parentElement!.parentElement!;
    expect(plain).not.toHaveTextContent('Should I ship it behind a flag?');
  });

  it('shows the quote from the message itself when the message it answers is not loaded', () => {
    // The excerpt rides on the replying message, so a paged-out referent still renders.
    state.messages = [
      message({ id: 'm9', body: 'the second one', direction: 'inbound', authorKind: 'human', replyToMessageId: 'm_gone', replyToExcerpt: 'which one did you mean?' }),
    ];
    render(<ChatRoute />);
    expect(screen.getByText('the second one').parentElement!.parentElement!).toHaveTextContent('which one did you mean?');
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
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
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

  it('clears the draft once the message is sent', () => {
    const view = render(<ChatRoute />);
    type('ship it');
    fireEvent.click(screen.getByLabelText('Send'));
    expect(state.posted).toHaveLength(1);
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

  it('restores the reply reference and the project tag with the text', () => {
    state.projects = [project({ id: 'p1', name: 'API' }), project({ id: 'p2', slug: 'web', name: 'Web' })];
    state.messages = [message({ id: 'm1', body: 'Should I ship it behind a flag?' })];

    const view = render(<ChatRoute />);
    fireEvent.click(screen.getByLabelText('Reply to this message'));
    fireEvent.change(screen.getByLabelText('Project for this message'), { target: { value: 'p2' } });
    type('yes, do it');
    view.unmount();

    render(<ChatRoute />);
    expect(box().value).toBe('yes, do it');
    expect(screen.getByText('Replying to the conductor')).toBeInTheDocument();
    expect((screen.getByLabelText('Project for this message') as HTMLSelectElement).value).toBe('p2');

    fireEvent.click(screen.getByLabelText('Send'));
    expect(state.posted[0]).toEqual({ threadId: 'th_1', body: 'yes, do it', projectId: 'p2', replyToMessageId: 'm1' });
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
