import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerMessageOutcome } from '../api/types';
import { agent, ticket } from './factories';

const state = vi.hoisted(() => ({
  input: { midTurn: false, reason: 'no turn is currently running for this agent' } as { midTurn: boolean; reason?: string },
  messageOutcome: { delivery: 'queued', runId: 'run_1', wakeId: 'wk_1' } as WorkerMessageOutcome,
  sent: [] as Array<{ id: string; ticketId: string; body: string; live?: boolean }>,
  runEventsRequests: [] as string[],
  actionMutate: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ workerId: 'a1' }) }));
vi.mock('../api/context', () => ({
  useWs: () => 'ws1',
  useHookWs: (o?: string) => o ?? 'ws1',
  useWorkspaceEvents: () => undefined,
}));
vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));

vi.mock('../api/hooks', () => ({
  useWorker: () => ({
    data: {
      agent: agent({ status: 'active' }),
      ticket: ticket({ id: 'tk_1' }),
      project: { id: 'p1', slug: 'api' },
      usage: null,
      worktree: null,
      input: state.input,
    },
    isLoading: false,
    isError: false,
  }),
  useWorkerBrief: () => ({ data: { brief: '# Brief' } }),
  useWorkerAction: () => ({ mutate: state.actionMutate }),
  useRunEvents: (id: string) => { state.runEventsRequests.push(id); return { data: [] }; },
  useWorkerMessage: () => ({
    mutateAsync: async (v: { id: string; ticketId: string; body: string; live?: boolean }) => {
      state.sent.push(v);
      return state.messageOutcome;
    },
  }),
}));

const { WorkerRoute } = await import('../routes/WorkerPage');

beforeEach(() => {
  state.sent = [];
  state.runEventsRequests = [];
  state.actionMutate = vi.fn();
  sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function composerInput(): HTMLElement {
  return screen.getByRole('textbox', { name: /steer this worker/i });
}

describe('WorkerPage composer — mid-turn capability and delivery outcome (VS-99)', () => {
  it('labels the composer "queued" when no turn is running', () => {
    state.input = { midTurn: false, reason: 'no turn is currently running for this agent' };
    render(<WorkerRoute />);
    expect(screen.getByText(/Queued for the next turn — no turn is currently running for this agent\./)).toBeInTheDocument();
  });

  it('names the limitation when the runtime cannot take mid-turn input at all', () => {
    state.input = { midTurn: false, reason: 'Codex does not support delivering input to a turn that is already running' };
    render(<WorkerRoute />);
    expect(screen.getByText(/Queued for the next turn — Codex does not support delivering input/)).toBeInTheDocument();
  });

  it('labels the composer as reaching the running turn when mid-turn delivery is available', () => {
    state.input = { midTurn: true };
    render(<WorkerRoute />);
    expect(screen.getByText('Reaches the running turn immediately.')).toBeInTheDocument();
  });

  it('shows which delivery actually happened after sending, and sends live', async () => {
    state.input = { midTurn: true };
    state.messageOutcome = { delivery: 'mid_turn', runId: 'run_1', wakeId: null };
    render(<WorkerRoute />);

    fireEvent.change(composerInput(), { target: { value: 'check the failing test' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(state.sent).toEqual([{ id: 'a1', ticketId: 'tk_1', body: 'check the failing test', live: true }]);
    expect(screen.getByText('Delivered to the running turn.')).toBeInTheDocument();
  });

  it('shows the queued outcome when delivery could not reach the running turn', async () => {
    state.input = { midTurn: true };
    state.messageOutcome = { delivery: 'queued', runId: 'run_1', wakeId: 'wk_2' };
    render(<WorkerRoute />);

    fireEvent.change(composerInput(), { target: { value: 'later is fine' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(screen.getByText('Queued for the next turn.')).toBeInTheDocument();
  });

  it('attaching (mount) and detaching (unmount) is a plain subscription: no mutation fires either way', () => {
    state.input = { midTurn: true };
    const { unmount } = render(<WorkerRoute />);
    expect(state.runEventsRequests.length).toBeGreaterThan(0);
    unmount();
    expect(state.sent).toEqual([]);
    expect(state.actionMutate).not.toHaveBeenCalled();
  });
});
