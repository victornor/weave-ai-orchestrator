/** VS-168: daemon-wide Live page. */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Run, Ticket } from '@agent-conductor/shared';
import { agent, ticket } from './factories';

const state = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string }>,
  workspacesError: false,
  workers: {} as Record<string, Agent[] | undefined>,
  errors: {} as Record<string, boolean>,
  tickets: {} as Record<string, Ticket[]>,
  running: {} as Record<string, Run[]>,
  queued: {} as Record<string, Run[]>,
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
  useRunEvents: () => ({ data: [], isLoading: false }),
}));

const { GlobalLiveRoute } = await import('../routes/GlobalLive');

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
});

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
});
