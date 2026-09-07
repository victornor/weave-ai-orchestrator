/**
 * VS-59: the ticket's Activity tab and the Run page show a turn's transcript.
 *
 * The two surfaces are tested through the real `useRunEventStream`, so what is asserted is the
 * behaviour that matters — whether a stream was opened at all, and for which run.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run, RunEvent } from '@agent-conductor/shared';
import { agent, run as makeRun, ticket } from './factories';

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  runs: [] as Run[],
  persisted: [] as RunEvent[],
  runDetail: null as Record<string, unknown> | null,
}));

vi.mock('@tanstack/react-router', () => ({ useParams: () => state.params }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn(), useSearchParams: () => ({}) }));

vi.mock('../api/hooks', () => ({
  useTicket: () => ({ data: { ticket: ticket({ id: 'tk_1' }), project: null, worker: agent(), blockers: [], mergeQueue: { position: null }, openspecState: null }, isLoading: false, isError: false }),
  useTicketComments: () => ({ data: [], isLoading: false }),
  useTicketRuns: () => ({ data: state.runs, isLoading: false }),
  useTicketDocument: () => ({ data: undefined, isLoading: false, isError: true }),
  useTicketDocumentRevisions: () => ({ data: [] }),
  useTicketWorkProducts: () => ({ data: [], isLoading: false }),
  useTicketUsage: () => ({ data: undefined, isLoading: false }),
  useTicketKnowledgeUsage: () => ({ data: undefined, isLoading: false }),
  usePatchTicket: () => ({ mutate: vi.fn() }),
  usePostComment: () => ({ mutate: vi.fn() }),
  useRetryTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useStartSession: () => ({ mutate: vi.fn(), isPending: false }),
  useDecisions: () => ({ data: [] }),
  useAnswerDecision: () => ({ mutate: vi.fn(), isPending: false }),
  useWorker: () => ({ data: undefined, isLoading: false, isError: false }),
  useWorkerMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRun: () => ({ data: state.runDetail, isLoading: false, isError: false }),
  useRunEvents: (id: string) => ({ data: id ? state.persisted : [], isLoading: false }),
}));

const { TicketRoute } = await import('../routes/TicketPage');
const { RunRoute } = await import('../routes/RunPage');

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
    act(() => {
      for (const fn of this.listeners.get(event.type) ?? []) fn({ data: JSON.stringify(event) } as MessageEvent<string>);
    });
  }
}

function ev(over: Partial<RunEvent> & Pick<RunEvent, 'id' | 'seq' | 'type'>): RunEvent {
  return { runId: 'run_1', ts: '2026-09-01T09:00:00.000Z', stream: 'stdout', level: 'info', payload: {}, ...over };
}

const live = (): FakeEventSource[] => FakeEventSource.open.filter((s) => !s.closed);
const stream = (): FakeEventSource => FakeEventSource.open[FakeEventSource.open.length - 1]!;

beforeEach(() => {
  FakeEventSource.open = [];
  state.params = { ticketId: 'tk_1', runId: 'run_1' };
  state.runs = [];
  state.persisted = [];
  state.runDetail = null;
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.clearAllMocks());

/** The Activity tab is not the ticket page's opening tab. */
function openActivity(): void {
  fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
}

describe('ticket Activity tab', () => {
  it('opens a running turn and streams its events as they arrive', () => {
    state.runs = [makeRun({ status: 'running', turnEpoch: 2 })];
    render(<TicketRoute />);
    openActivity();

    expect(screen.getByText('turn 2')).toBeInTheDocument();
    expect(stream().url).toBe('/api/w/ws1/runs/run_1/events/stream');
    expect(screen.getByRole('button', { name: 'hide transcript' })).toBeInTheDocument();

    stream().emit(ev({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Reading the failing test.' } }));
    expect(screen.getByText('Reading the failing test.')).toBeInTheDocument();

    stream().emit(ev({ id: 'e2', seq: 2, type: 'tool.call', payload: { id: 't1', name: 'Bash', input: { command: 'pnpm test' } } }));
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('pnpm test')).toBeInTheDocument();

    stream().emit(ev({ id: 'e3', seq: 3, type: 'run.phase.timing', payload: { phase: 'deliver', durationMs: 1200 } }));
    expect(screen.getByText(/phase: deliver/)).toBeInTheDocument();

    // The box follows its own bottom and nothing else: `scrollIntoView` walks every scrollable
    // ancestor, so using it here would drag the ticket's feed down on every event.
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('collapses the turn to its summary row when the run finishes, and closes the stream', () => {
    state.runs = [makeRun({ status: 'running', turnEpoch: 2 })];
    const { rerender } = render(<TicketRoute />);
    openActivity();
    stream().emit(ev({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Reading the failing test.' } }));
    expect(live()).toHaveLength(1);

    // What the daemon's `run.finished` event does to this page: the ticket's runs refetch.
    state.runs = [makeRun({ status: 'succeeded', turnEpoch: 2, finishedAt: '2026-09-01T09:04:00.000Z', summary: 'Fixed the failing test.' })];
    rerender(<TicketRoute />);

    expect(live()).toHaveLength(0);
    expect(screen.queryByText('Reading the failing test.')).not.toBeInTheDocument();
    expect(screen.getByText('Fixed the failing test.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'show transcript' })).toBeInTheDocument();
  });

  it('expands a finished turn on demand, fetched rather than streamed', () => {
    state.runs = [makeRun({ status: 'succeeded', turnEpoch: 1, finishedAt: '2026-09-01T09:04:00.000Z' })];
    state.persisted = [ev({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'What the last turn did.' } })];
    render(<TicketRoute />);
    openActivity();

    // Nothing is asked for while it is collapsed — a ticket with thirty turns fetches none of them.
    expect(screen.queryByText('What the last turn did.')).not.toBeInTheDocument();
    expect(FakeEventSource.open).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'show transcript' }));
    expect(screen.getByText('What the last turn did.')).toBeInTheDocument();
    expect(FakeEventSource.open).toHaveLength(0);
  });
});

describe('RunRoute', () => {
  const detail = (over: Partial<Run> = {}): Record<string, unknown> => ({
    run: makeRun(over),
    agent: agent(),
    ticket: ticket(),
    phases: [],
    usage: null,
  });

  it('follows a running turn, then stops when it finishes', () => {
    state.runDetail = detail({ status: 'running' });
    const { rerender } = render(<RunRoute />);

    expect(stream().url).toBe('/api/w/ws1/runs/run_1/events/stream');
    expect(screen.getByText('· following')).toBeInTheDocument();

    stream().emit(ev({ id: 'e1', seq: 1, type: 'assistant.text', payload: { text: 'Half way through.' } }));
    expect(screen.getByText('Half way through.')).toBeInTheDocument();

    state.runDetail = detail({ status: 'succeeded', finishedAt: '2026-09-01T09:04:00.000Z' });
    rerender(<RunRoute />);

    expect(live()).toHaveLength(0);
    expect(screen.queryByText('· following')).not.toBeInTheDocument();
    // Stopping the follow is not losing the transcript: what it streamed stays on the page.
    expect(screen.getByText('Half way through.')).toBeInTheDocument();
  });

  it('opens no stream for a run that was already finished, and renders the persisted events', () => {
    state.runDetail = detail({ status: 'failed', errorCode: 'usage_limit', finishedAt: '2026-09-01T09:04:00.000Z' });
    state.persisted = [ev({ id: 'e1', seq: 1, type: 'error', payload: { message: 'usage limit reached' } })];
    render(<RunRoute />);

    expect(FakeEventSource.open).toHaveLength(0);
    expect(screen.getByText('usage limit reached')).toBeInTheDocument();
  });
});

describe('Transcript window', () => {
  it('renders the newest blocks only, and reveals the earlier ones on demand', async () => {
    const { Transcript } = await import('../components/Transcript');
    const events = Array.from({ length: 7 }, (_, i) =>
      ev({ id: `e${i}`, seq: i, type: 'tool.call', payload: { id: `t${i}`, name: `Tool${i}` } }),
    );
    render(<Transcript events={events} window={3} />);

    expect(screen.queryByText('Tool0')).not.toBeInTheDocument();
    expect(screen.getByText('Tool6')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show earlier (4)' }));
    expect(screen.getByText('Tool1')).toBeInTheDocument();
    expect(screen.queryByText('Tool0')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show earlier (1)' }));
    expect(screen.getByText('Tool0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show earlier/ })).not.toBeInTheDocument();
  });
});
