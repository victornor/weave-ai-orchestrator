import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPauseDetail, AgentStatus } from '@weave-ai/shared';
import type { HandoverCommandResult, WorkerMessageOutcome } from '../api/types';
import { agent, ticket } from './factories';

const state = vi.hoisted(() => ({
  input: { midTurn: false, reason: 'no turn is currently running for this agent' } as { midTurn: boolean; interrupts?: boolean; reason?: string },
  messageOutcome: { delivery: 'queued', runId: 'run_1', wakeId: 'wk_1' } as WorkerMessageOutcome,
  sent: [] as Array<{ id: string; ticketId: string; body: string; live?: boolean }>,
  runEventsRequests: [] as string[],
  actionMutate: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  // VS-249
  agentStatus: 'active' as AgentStatus,
  agentPauseDetail: null as AgentPauseDetail | null,
  handoverCommand: undefined as HandoverCommandResult | undefined,
  handoverCalls: [] as Array<{ id: string; enabled: boolean }>,
  startMutate: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  endMutateAsync: vi.fn(async () => undefined) as unknown as ReturnType<typeof vi.fn>,
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
      agent: agent({ status: state.agentStatus, pauseDetail: state.agentPauseDetail }),
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
  useHandoverCommand: (id: string, enabled: boolean) => {
    state.handoverCalls.push({ id, enabled });
    return { data: enabled ? state.handoverCommand : undefined, isLoading: false, isError: false };
  },
  useStartHandover: () => ({ mutate: state.startMutate }),
  useEndHandover: () => ({ mutateAsync: state.endMutateAsync }),
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(() => 'id'), dismiss: vi.fn() }) }));

const { WorkerRoute } = await import('../routes/WorkerPage');

beforeEach(() => {
  state.sent = [];
  state.runEventsRequests = [];
  state.actionMutate = vi.fn();
  state.agentStatus = 'active';
  state.agentPauseDetail = null;
  state.handoverCommand = undefined;
  state.handoverCalls = [];
  state.startMutate = vi.fn();
  state.endMutateAsync = vi.fn(async () => undefined);
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

  it('labels the composer as interrupting the running turn when the runtime cannot take mid-turn input but a turn is running (VS-254)', () => {
    state.input = { midTurn: false, interrupts: true };
    render(<WorkerRoute />);
    expect(screen.getByText('Interrupts the running turn; the agent answers once its next turn starts.')).toBeInTheDocument();
  });

  it('shows the interrupted outcome after sending interrupts the running turn (VS-254)', async () => {
    state.input = { midTurn: false, interrupts: true };
    state.messageOutcome = { delivery: 'interrupted', runId: 'run_1', wakeId: 'wk_3' };
    render(<WorkerRoute />);

    fireEvent.change(composerInput(), { target: { value: 'stop, wrong direction' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(screen.getByText('Interrupted the running turn; it will be answered once the next turn starts.')).toBeInTheDocument();
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

describe('WorkerPage session handover (VS-249)', () => {
  it('does not fetch the command until Session is opened, for a worker that is not held', () => {
    render(<WorkerRoute />);
    expect(state.handoverCalls.every((c) => !c.enabled)).toBe(true);
    expect(screen.queryByRole('button', { name: /take this session/i })).not.toBeInTheDocument();
  });

  it('opens the band and shows the command when Session is clicked', () => {
    state.handoverCommand = { resumable: true, command: "cd '/home/a1' && claude --resume sess-1", runtime: 'claude', landingLine: 'Lands in the home directory.', reason: null };
    render(<WorkerRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Session' }));
    expect(screen.getByText('Lands in the home directory.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /take this session/i })).toBeInTheDocument();
  });

  it('shows the stated reason and no Take-session button for an unresumable worker', () => {
    state.handoverCommand = { resumable: false, command: null, runtime: 'gemini', landingLine: null, reason: 'gemini cannot resume a session outside the daemon.' };
    render(<WorkerRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Session' }));
    expect(screen.getByText('gemini cannot resume a session outside the daemon.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /take this session/i })).not.toBeInTheDocument();
  });

  it('calls startHandover for this worker when Take this session is clicked', () => {
    state.handoverCommand = { resumable: true, command: 'claude --resume sess-1', runtime: 'claude', landingLine: null, reason: null };
    render(<WorkerRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Session' }));
    fireEvent.click(screen.getByRole('button', { name: /take this session/i }));
    expect(state.startMutate).toHaveBeenCalledWith({ id: 'a1' }, expect.anything());
  });

  it('a held worker shows Give it back instead of Resume, and no Session toggle', () => {
    state.agentStatus = 'paused';
    state.agentPauseDetail = { family: null, code: 'held_by_human', message: null, resetAt: null, runId: null };
    render(<WorkerRoute />);
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Session' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /give it back/i }).length).toBeGreaterThan(0);
  });

  it('giving a session back requires a note and calls endHandover with it', async () => {
    state.agentStatus = 'paused';
    state.agentPauseDetail = { family: null, code: 'held_by_human', message: null, resetAt: null, runId: null };
    state.handoverCommand = { resumable: true, command: 'claude --resume sess-1', runtime: 'claude', landingLine: null, reason: null };
    render(<WorkerRoute />);

    const giveItBackButtons = screen.getAllByRole('button', { name: /give it back/i });
    fireEvent.click(giveItBackButtons[0]!);

    const noteInput = screen.getByPlaceholderText(/what did you do while you held this session/i);
    fireEvent.change(noteInput, { target: { value: 'attached Frida to the device' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /give it back/i }));
    });

    expect(state.endMutateAsync).toHaveBeenCalledWith({ id: 'a1', note: 'attached Frida to the device' });
  });
});
