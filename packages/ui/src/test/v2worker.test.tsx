/** VS-350: the V2 worker page — identity, tabs, shared feed, actions, handover and steer. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@weave-ai/shared';
import { agent, ticket } from './factories';

const state = vi.hoisted(() => ({
  agent: null as Agent | null,
  go: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  action: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  send: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  end: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  start: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  patch: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  actionError: null as Error | null,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) => (o?.select ? o.select({ location: { pathname: '/v2/w/ws1/workers/a1' } }) : '/v2/w/ws1/workers/a1'),
  useParams: () => ({ ws: 'ws1', workerId: 'a1' }),
}));
vi.mock('../app/link', () => ({ useGo: () => state.go, useSearchParams: () => ({}) }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../lib/drafts', () => ({ draftKey: () => 'k', useDraft: () => ({ draft: { text: 'steer this' }, patch: state.patch }) }));
vi.mock('../v2/WorkerFeed', () => ({ WorkerFeed: () => <div data-testid="worker-feed" /> }));
vi.mock('../api/hooks', () => ({
  useWorker: () => ({ data: state.agent ? { agent: state.agent, ticket: ticket({ id: 'tk1', identifier: 'ACME-1' }), role: null, project: null, lastRun: null, usage: null, worktree: null, scheduledWake: null, input: { midTurn: false, interrupts: false } } : undefined, isLoading: false, isError: false }),
  useWorkerBrief: () => ({ data: { brief: '# The brief' } }),
  useWorkerAction: () => ({ mutate: state.action, error: state.actionError }),
  useWorkerMessage: () => ({ mutateAsync: state.send, error: null }),
  useHandoverCommand: () => ({ isLoading: false, data: null }),
  useStartHandover: () => ({ mutate: state.start, error: null }),
  useEndHandover: () => ({ mutateAsync: state.end, error: null }),
  useWorkers: () => ({ data: [] }),
  useIncidents: () => ({ data: { items: [], total: 0 } }),
  useWorkspaces: () => ({ data: [] }),
}));

const { WorkerBody } = await import('../v2/WorkerPage');

beforeEach(() => {
  state.go = vi.fn();
  state.action = vi.fn();
  state.send = vi.fn().mockResolvedValue({ delivery: 'mid_turn' });
  state.end = vi.fn().mockResolvedValue(undefined);
  state.start = vi.fn();
  state.patch = vi.fn();
  state.actionError = null;
  state.agent = agent({ id: 'a1', name: 'Backend Engineer #7', status: 'running', runtimeId: 'claude-code' });
});

describe('V2 worker page', () => {
  it('shows the worker identity and renders the brief tab', () => {
    render(<WorkerBody workerId="a1" />);
    expect(screen.getByText('Backend Engineer #7')).toBeInTheDocument();
    expect(screen.getByTestId('worker-feed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Brief' }));
    expect(screen.getByRole('heading', { name: 'The brief' })).toBeInTheDocument();
  });

  it('offers Resume when the worker is paused', () => {
    state.agent = agent({ id: 'a1', name: 'Backend Engineer #7', status: 'paused', runtimeId: 'claude-code' });
    render(<WorkerBody workerId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(state.action).toHaveBeenCalledWith({ id: 'a1', action: 'resume' });
  });

  it('posts a steer message and reports the delivery outcome', async () => {
    render(<WorkerBody workerId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(state.send).toHaveBeenCalledWith({ id: 'a1', ticketId: 'tk1', body: 'steer this', live: true });
    expect(await screen.findByText('Delivered to the running turn.')).toBeInTheDocument();
  });

  it('gives a held session back with a note', async () => {
    state.agent = agent({ id: 'a1', name: 'Backend Engineer #7', status: 'paused', runtimeId: 'claude-code', pauseDetail: { code: 'held_by_human', family: null, message: null, resetAt: null, runId: null } });
    render(<WorkerBody workerId="a1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Give it back' })[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText('What did you do while you held this session?'), { target: { value: 'did stuff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Give it back' }));
    expect(state.end).toHaveBeenCalledWith({ id: 'a1', note: 'did stuff' });
  });

  it('shows a failed action error instead of failing silently', () => {
    state.actionError = new Error('the worker is already gone');
    render(<WorkerBody workerId="a1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('the worker is already gone');
  });

  it('requires a confirmation before cancelling', () => {
    render(<WorkerBody workerId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
    expect(state.action).toHaveBeenCalledWith({ id: 'a1', action: 'cancel', reason: 'cancelled from the web app' });
  });
});
