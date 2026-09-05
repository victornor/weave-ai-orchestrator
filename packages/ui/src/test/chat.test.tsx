import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Project, RunEvent, ThreadMessage, Ticket, WorkspaceEvent } from '@agent-conductor/shared';
import { agent, project, ticket } from './factories';
import { enqueue } from '../lib/queue';

const bus = vi.hoisted(() => ({ handlers: new Set<(e: WorkspaceEvent) => void>() }));
const state = vi.hoisted(() => ({
  conductor: { agent: { id: 'ag_conductor' }, lastRun: null as { id: string; status: string } | null },
  messages: [] as ThreadMessage[],
  persisted: [] as RunEvent[],
  tickets: [] as Ticket[],
  workers: [] as Agent[],
  ticketQuery: null as Record<string, unknown> | null,
  workerQuery: null as Record<string, unknown> | null,
  projects: [] as Project[],
  posted: [] as Array<Record<string, unknown>>,
  connection: 'connected' as string,
}));

vi.mock('../api/context', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    useWs: () => 'ws1',
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
  useThreadMessages: () => ({ data: state.messages, isLoading: false, isError: false, refetch: vi.fn() }),
  usePostThreadMessage: () => ({ mutate: (v: Record<string, unknown>) => state.posted.push(v) }),
  useDecisions: () => ({ data: [] }),
  useAnswerDecision: () => ({ mutate: vi.fn(), isPending: false }),
  useTickets: (p: Record<string, unknown>) => { state.ticketQuery = p; return { data: state.tickets }; },
  useWorkers: (p: Record<string, unknown>) => { state.workerQuery = p; return { data: state.workers }; },
  useProjects: () => ({ data: state.projects, isSuccess: true }),
}));

vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));
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
  state.persisted = [];
  state.tickets = [];
  state.workers = [];
  state.ticketQuery = null;
  state.workerQuery = null;
  state.projects = [project({ id: 'p1', name: 'API' })];
  state.posted = [];
  state.connection = 'connected';
  vi.mocked(enqueue).mockClear();
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
