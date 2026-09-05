import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent, ThreadMessage, WorkspaceEvent } from '@agent-conductor/shared';

const bus = vi.hoisted(() => ({ handlers: new Set<(e: WorkspaceEvent) => void>() }));
const state = vi.hoisted(() => ({
  conductor: { agent: { id: 'ag_conductor' }, lastRun: null as { id: string; status: string } | null },
  messages: [] as ThreadMessage[],
  persisted: [] as RunEvent[],
}));

vi.mock('../api/context', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    useWs: () => 'ws1',
    useConnection: () => ({ state: 'connected', capturedAt: null, lastSeq: 0, attempts: 0 }),
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
  usePostThreadMessage: () => ({ mutate: vi.fn() }),
  useDecisions: () => ({ data: [] }),
  useAnswerDecision: () => ({ mutate: vi.fn(), isPending: false }),
  useTickets: () => ({ data: [] }),
  useWorkers: () => ({ data: [] }),
  useProjects: () => ({ data: [{ id: 'p1' }], isSuccess: true }),
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
    threadId: 'th_1', direction: 'outbound', authorKind: 'agent', authorId: 'ag_conductor', runId: 'run_1',
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
