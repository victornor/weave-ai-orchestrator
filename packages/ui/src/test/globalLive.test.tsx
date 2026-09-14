/** VS-168: daemon-wide Live page. */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Run, RunEvent, Ticket, WorkerModelOption } from '@weave-ai/shared';
import { agent, run as makeRun, ticket } from './factories';
import { LIVE_RUN_GRACE_MS } from '../lib/liveOrder';
import { resetWorkspaceStreams } from '../api/streams';

const state = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string }>,
  workspacesError: false,
  workers: {} as Record<string, Agent[] | undefined>,
  errors: {} as Record<string, boolean>,
  tickets: {} as Record<string, Ticket[]>,
  running: {} as Record<string, Run[]>,
  queued: {} as Record<string, Run[]>,
  recent: {} as Record<string, Run[]>,
  persisted: [] as RunEvent[],
  models: {} as Record<string, WorkerModelOption[] | undefined>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({
  A: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: React.ReactNode }) => (
    <a href={Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)} {...rest}>{children}</a>
  ),
}));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: state.workspacesError ? undefined : state.workspaces, isError: state.workspacesError, error: null, refetch: vi.fn() }),
  useWorkersMany: (ids: string[]) => ids.map((id) => ({ data: state.workers[id], isError: Boolean(state.errors[id]), refetch: vi.fn() })),
  useTicketsMany: (ids: string[]) => ids.map((id) => ({ data: state.tickets[id] ?? [] })),
  useRunsMany: (ids: string[], params: { status?: string } = {}) => ids.map((id) => ({
    data: params.status === 'queued' ? (state.queued[id] ?? []) : params.status === 'running' ? (state.running[id] ?? []) : (state.recent[id] ?? []),
  })),
  useModelsMany: (ids: string[]) => ids.map((id) => ({ data: state.models[id] === undefined ? undefined : { workerOptions: state.models[id] } })),
  useRunEvents: () => ({ data: state.persisted, isLoading: false }),
}));

const { GlobalLiveRoute } = await import('../routes/GlobalLive');

class FakeEventSource {
  static open: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(m: MessageEvent<string>) => void>>();
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.open.push(this); }
  addEventListener(type: string, fn: (m: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void { this.closed = true; }
  emit(event: RunEvent): void {
    act(() => {
      for (const fn of this.listeners.get(event.type) ?? []) fn({ data: JSON.stringify(event) } as MessageEvent<string>);
    });
  }
  /** A `run.event` workspace frame, as the daemon broadcasts it on the shared stream (VS-417). */
  emitRun(event: RunEvent): void {
    act(() => {
      const frame = { seq: 0, workspaceId: 'alpha', type: 'run.event', entityType: 'run', entityId: event.runId, payload: { runId: event.runId, event }, createdAt: '' };
      for (const fn of this.listeners.get('run.event') ?? []) fn({ data: JSON.stringify(frame) } as MessageEvent<string>);
    });
  }
}

const live = (): FakeEventSource[] => FakeEventSource.open.filter((s) => !s.closed);

beforeEach(() => {
  state.workspaces = [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
  ];
  state.workspacesError = false;
  state.workers = { alpha: [], beta: [] };
  state.errors = {};
  state.tickets = {};
  state.running = {};
  state.queued = {};
  state.recent = {};
  state.persisted = [];
  state.models = {};
  FakeEventSource.open = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { resetWorkspaceStreams(); vi.clearAllMocks(); });

const opt = (id: string): WorkerModelOption => ({ id, description: `${id} tier`, runtime: 'claude', model: null });

/** The worker name in each rendered cell, in document order. */
function cellNames(): string[] {
  return screen.getAllByRole('article').map((el) => el.querySelector('header .text-ui')?.textContent ?? '');
}

describe('GlobalLiveRoute', () => {
  it('shows cells from two workspaces and names them', () => {
    const a = agent({ id: 'w1', name: 'Frontend #1', status: 'running', ticketId: 't1' });
    const b = agent({ id: 'w2', name: 'Backend #1', status: 'running', ticketId: 't2' });
    state.workers = { alpha: [a], beta: [b] };
    state.tickets = {
      alpha: [ticket({ id: 't1', identifier: 'ALP-1', title: 'One' })],
      beta: [ticket({ id: 't2', identifier: 'BET-1', title: 'Two' })],
    };
    render(<GlobalLiveRoute />);
    expect(screen.getByText('Frontend #1')).toBeInTheDocument();
    expect(screen.getByText('Backend #1')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText(/ALP-1/).closest('a')).toHaveAttribute('href', '/w/alpha/tickets/ALP-1');
  });

  it('excludes the conductor', () => {
    state.workers = { alpha: [agent({ id: 'c1', kind: 'weaver', status: 'running', ticketId: null, name: 'Weaver' })], beta: [] };
    render(<GlobalLiveRoute />);
    expect(screen.queryByText('Conductor')).not.toBeInTheDocument();
    expect(screen.getByText('Nobody is working.')).toBeInTheDocument();
  });

  it('stays silent when one workspace is idle', () => {
    const a = agent({ id: 'w1', name: 'Frontend #1', status: 'running', ticketId: 't1' });
    state.workers = { alpha: [a], beta: [] };
    state.tickets = { alpha: [ticket({ id: 't1', identifier: 'ALP-1', title: 'One' })] };
    render(<GlobalLiveRoute />);
    expect(screen.getByText('Frontend #1')).toBeInTheDocument();
    expect(screen.queryByText(/Could not load/)).not.toBeInTheDocument();
  });

  it('keeps the other workspace when one fails', () => {
    const a = agent({ id: 'w1', name: 'Frontend #1', status: 'running', ticketId: 't1' });
    state.workers = { alpha: [a], beta: undefined };
    state.errors = { beta: true };
    state.tickets = { alpha: [ticket({ id: 't1', identifier: 'ALP-1', title: 'One' })] };
    render(<GlobalLiveRoute />);
    expect(screen.getByText('Frontend #1')).toBeInTheDocument();
    expect(screen.getByText(/Could not load who is working in Beta/)).toBeInTheDocument();
  });

  it('shows loading while a workspace has not arrived', () => {
    state.workers = { alpha: undefined, beta: undefined };
    render(<GlobalLiveRoute />);
    expect(screen.queryByText('Nobody is working.')).not.toBeInTheDocument();
  });

  it('shows empty when nobody is working anywhere', () => {
    render(<GlobalLiveRoute />);
    expect(screen.getByText('Nobody is working.')).toBeInTheDocument();
  });

  it('carries the workspace\'s tier tag on a cell when several options are configured there (VS-217)', () => {
    state.models = { alpha: [opt('quick'), opt('standard'), opt('deep')], beta: [] };
    state.workers = {
      alpha: [agent({ id: 'w1', name: 'Frontend #1', status: 'running', ticketId: 't1' })],
      beta: [agent({ id: 'w2', name: 'Backend #1', status: 'running', ticketId: 't2' })],
    };
    state.tickets = {
      alpha: [ticket({ id: 't1', identifier: 'ALP-1', title: 'One', workerModelId: 'deep' })],
      beta: [ticket({ id: 't2', identifier: 'BET-1', title: 'Two', workerModelId: 'quick' })],
    };
    render(<GlobalLiveRoute />);
    expect(screen.getByText('deep')).toBeInTheDocument();
    // Beta configures fewer than two options: no tag there, whatever alpha shows.
    expect(screen.queryByText('quick')).not.toBeInTheDocument();
  });

  it('opens one shared stream per workspace with a live tail, not one per tile (VS-417)', () => {
    state.workers = {
      alpha: [
        agent({ id: 'w1', name: 'Frontend #1', status: 'running', ticketId: 't1' }),
        agent({ id: 'w2', name: 'Frontend #2', status: 'running', ticketId: 't2' }),
      ],
      beta: [agent({ id: 'w3', name: 'Backend #1', status: 'running', ticketId: 't3' })],
    };
    state.tickets = {
      alpha: [ticket({ id: 't1', identifier: 'ALP-1', title: 'One' }), ticket({ id: 't2', identifier: 'ALP-2', title: 'Two' })],
      beta: [ticket({ id: 't3', identifier: 'BET-1', title: 'Three' })],
    };
    state.running = {
      alpha: [makeRun({ id: 'run_1', agentId: 'w1', status: 'running' }), makeRun({ id: 'run_2', agentId: 'w2', status: 'running' })],
      beta: [makeRun({ id: 'run_3', agentId: 'w3', status: 'running' })],
    };
    render(<GlobalLiveRoute />);
    // V1 still caps the live tails it holds, and its two slots land on alpha's tiles; both ride
    // alpha's one stream rather than one `EventSource` each.
    expect(live().map((s) => s.url)).toEqual(['/api/w/alpha/events']);
  });

  it('keeps a between-turns worker\'s last run and hands off to the next (VS-332)', () => {
    const evt = (seq: number, text: string, runId: string): RunEvent => ({ id: `e${seq}`, runId, seq, ts: '2026-09-01T09:00:00.000Z', type: 'assistant.text', stream: 'stdout', level: 'info', payload: { text } });
    const a = agent({ id: 'w1', name: 'Frontend #1', status: 'active', ticketId: 't1' });
    state.workers = { alpha: [a], beta: [] };
    state.tickets = { alpha: [ticket({ id: 't1', identifier: 'ALP-1', title: 'One' })] };
    state.recent = { alpha: [makeRun({ id: 'run_1', agentId: 'w1', status: 'succeeded' })] };
    state.persisted = [evt(1, 'First turn.', 'run_1')];
    const { rerender } = render(<GlobalLiveRoute />);

    expect(live()).toEqual([]);
    expect(screen.getByText('First turn.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the next turn.')).toBeInTheDocument();

    state.running = { alpha: [makeRun({ id: 'run_2', agentId: 'w1', status: 'running' })] };
    state.recent = { alpha: [makeRun({ id: 'run_2', agentId: 'w1', status: 'running' })] };
    state.persisted = [];
    rerender(<GlobalLiveRoute />);

    expect(live().map((s) => s.url)).toEqual(['/api/w/alpha/events']);
    expect(screen.getByText('First turn.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for the next turn.')).not.toBeInTheDocument();

    live()[0]!.emitRun(evt(1, 'New turn.', 'run_2'));
    expect(screen.getByText('New turn.')).toBeInTheDocument();
  });

  it('orders running cells before waiting ones across the page, not per workspace (VS-337)', () => {
    state.workers = {
      alpha: [
        agent({ id: 'w1', name: 'Alpha Waiting', status: 'active', ticketId: 't1', createdAt: '2026-09-04T00:00:00.000Z' }),
        agent({ id: 'w2', name: 'Alpha Running', status: 'running', ticketId: 't2', createdAt: '2026-09-03T00:00:00.000Z' }),
      ],
      beta: [
        agent({ id: 'w3', name: 'Beta Waiting', status: 'active', ticketId: 't3', createdAt: '2026-09-03T00:00:00.000Z' }),
        agent({ id: 'w4', name: 'Beta Running', status: 'running', ticketId: 't4', createdAt: '2026-09-02T00:00:00.000Z' }),
      ],
    };
    state.tickets = {
      alpha: [ticket({ id: 't1', identifier: 'ALP-1' }), ticket({ id: 't2', identifier: 'ALP-2' })],
      beta: [ticket({ id: 't3', identifier: 'BET-1' }), ticket({ id: 't4', identifier: 'BET-2' })],
    };
    state.running = {
      alpha: [makeRun({ id: 'run_2', agentId: 'w2', status: 'running' })],
      beta: [makeRun({ id: 'run_4', agentId: 'w4', status: 'running' })],
    };
    render(<GlobalLiveRoute />);

    // A per-workspace restart would read Alpha Running, Alpha Waiting, Beta Running, Beta Waiting.
    expect(cellNames()).toEqual(['Alpha Running', 'Beta Running', 'Alpha Waiting', 'Beta Waiting']);
  });

  it('keeps a just-finished cell in the running group until the grace window elapses (VS-337)', () => {
    vi.useFakeTimers();
    try {
      state.workers = {
        alpha: [
          agent({ id: 'a1', name: 'Finish Soon', status: 'running', ticketId: 't1', createdAt: '2026-09-01T00:00:00.000Z' }),
          agent({ id: 'a2', name: 'Waiting', status: 'active', ticketId: 't2', createdAt: '2026-09-02T00:00:00.000Z' }),
        ],
        beta: [],
      };
      state.tickets = { alpha: [ticket({ id: 't1', identifier: 'ALP-1' }), ticket({ id: 't2', identifier: 'ALP-2' })] };
      state.running = { alpha: [makeRun({ id: 'run_1', agentId: 'a1', status: 'running' })] };
      state.recent = { alpha: [makeRun({ id: 'run_1', agentId: 'a1', status: 'running' })] };
      const { rerender } = render(<GlobalLiveRoute />);
      expect(cellNames()).toEqual(['Finish Soon', 'Waiting']);

      state.running = { alpha: [] };
      state.recent = { alpha: [makeRun({ id: 'run_1', agentId: 'a1', status: 'succeeded' })] };
      rerender(<GlobalLiveRoute />);
      expect(cellNames()).toEqual(['Finish Soon', 'Waiting']);

      act(() => vi.advanceTimersByTime(LIVE_RUN_GRACE_MS));
      expect(cellNames()).toEqual(['Waiting', 'Finish Soon']);
    } finally {
      vi.useRealTimers();
    }
  });
});
