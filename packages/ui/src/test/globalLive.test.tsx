/** VS-168: daemon-wide Live page. */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Run, Ticket, WorkerModelOption } from '@agent-conductor/shared';
import { agent, run as makeRun, ticket } from './factories';

const state = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string }>,
  workspacesError: false,
  workers: {} as Record<string, Agent[] | undefined>,
  errors: {} as Record<string, boolean>,
  tickets: {} as Record<string, Ticket[]>,
  running: {} as Record<string, Run[]>,
  queued: {} as Record<string, Run[]>,
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
    data: params.status === 'queued' ? (state.queued[id] ?? []) : (state.running[id] ?? []),
  })),
  useModelsMany: (ids: string[]) => ids.map((id) => ({ data: state.models[id] === undefined ? undefined : { workerOptions: state.models[id] } })),
  useRunEvents: () => ({ data: [], isLoading: false }),
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
  state.models = {};
  FakeEventSource.open = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.clearAllMocks());

const opt = (id: string): WorkerModelOption => ({ id, description: `${id} tier`, runtime: 'claude', model: null });

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
    state.workers = { alpha: [agent({ id: 'c1', kind: 'conductor', status: 'running', ticketId: null, name: 'Conductor' })], beta: [] };
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

  it('caps concurrent run-tail EventSources at two across workspaces (VS-227)', () => {
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
    expect(live().map((s) => s.url)).toEqual([
      '/api/w/alpha/runs/run_1/events/stream',
      '/api/w/alpha/runs/run_2/events/stream',
    ]);
  });
});
