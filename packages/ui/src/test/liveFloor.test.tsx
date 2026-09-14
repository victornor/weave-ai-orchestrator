/**
 * VS-152: the Live page is a grid of currently-working workers, each streaming its run.
 * VS-164: cells drag-resize on desktop and expand by tap on the phone.
 * VS-206: spans are fine `gridColumn`/`gridRow` inline style, not `col-span-N` classes; a cell's
 * `--ac-cell-rows` custom property (its row span normalized to GRANULARITY units) drives the
 * transcript's proportional max-height instead of a class name carrying the fraction.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Run, RunEvent, Ticket, WorkerModelOption } from '@weave-ai/shared';
import { agent, run as makeRun, ticket } from './factories';
import { LIVE_RUN_GRACE_MS } from '../lib/liveOrder';
import { resetWorkspaceStreams } from '../api/streams';

const state = vi.hoisted(() => ({
  workers: undefined as Agent[] | undefined,
  workersError: false,
  tickets: [] as Ticket[],
  workerOptions: undefined as WorkerModelOption[] | undefined,
  running: [] as Run[],
  queued: [] as Run[],
  recent: [] as Run[],
  persisted: [] as RunEvent[],
  persistedNewest: [] as RunEvent[],
}));

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({}) }));
vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../app/link', () => ({
  A: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: React.ReactNode }) => (
    <a href={Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)} {...rest}>{children}</a>
  ),
  useGo: () => vi.fn(),
  useSearchParams: () => ({}),
}));

vi.mock('../api/hooks', () => ({
  useWorkers: () => ({
    data: state.workers,
    isError: state.workersError,
    refetch: vi.fn(),
  }),
  useTickets: () => ({ data: state.tickets, isLoading: false, isError: false }),
  useModels: () => ({ data: state.workerOptions === undefined ? undefined : { workerOptions: state.workerOptions } }),
  useRuns: (params: { status?: string } = {}) => ({
    data: params.status === 'queued' ? state.queued : params.status === 'running' ? state.running : state.recent,
    isLoading: false,
  }),
  useRunEvents: (id: string, _after?: number, _ws?: string, opts?: { newest?: boolean }) => ({ data: id ? (opts?.newest ? state.persistedNewest : state.persisted) : [], isLoading: false }),
}));

const { LiveRoute, LiveCell } = await import('../routes/Live');

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
  /** A `run.event` workspace frame, as the daemon broadcasts it on the shared stream (VS-417). */
  emitRun(event: RunEvent): void {
    act(() => {
      const frame = { seq: 0, workspaceId: 'ws1', type: 'run.event', entityType: 'run', entityId: event.runId, payload: { runId: event.runId, event }, createdAt: '' };
      for (const fn of this.listeners.get('run.event') ?? []) fn({ data: JSON.stringify(frame) } as MessageEvent<string>);
    });
  }
}

const live = (): FakeEventSource[] => FakeEventSource.open.filter((s) => !s.closed);

const phoneMedia = (): MediaQueryList => ({
  matches: false,
  media: '',
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
});

beforeEach(() => {
  FakeEventSource.open = [];
  state.workers = [];
  state.workersError = false;
  state.tickets = [];
  state.workerOptions = undefined;
  state.running = [];
  state.queued = [];
  state.recent = [];
  state.persisted = [];
  state.persistedNewest = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = ((q: string) => ({ ...phoneMedia(), media: q })) as unknown as typeof window.matchMedia;
});
afterEach(() => { resetWorkspaceStreams(); vi.clearAllMocks(); });

function twoWorkers(): void {
  state.workers = [
    agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'running' }),
    agent({ id: 'a2', name: 'Backend Engineer #1', ticketId: 'tk_2', status: 'active' }),
  ];
  state.tickets = [
    ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode' }),
    ticket({ id: 'tk_2', identifier: 'ACME-7', title: 'Flaky test' }),
  ];
}

function stubSm(): void {
  window.matchMedia = ((q: string) => ({
    ...phoneMedia(),
    media: q,
    matches: q.includes('min-width: 40rem') && !q.includes('80rem'),
  })) as unknown as typeof window.matchMedia;
}

function layout(el: HTMLElement, width = 200, height = 150): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: 0, left: 0, bottom: height, right: width, width, height, x: 0, y: 0, toJSON: () => ({}),
    }),
  });
}

function cellOf(name: string): HTMLElement {
  return screen.getByText(name).closest('article') as HTMLElement;
}

/** The worker name in each rendered cell, in document order. */
function cellNames(): string[] {
  return screen.getAllByRole('article').map((el) => el.querySelector('header .text-ui')?.textContent ?? '');
}

function evt(seq: number, text: string, runId = 'run_1'): RunEvent {
  return { id: `e${seq}`, runId, seq, ts: '2026-09-01T09:00:00.000Z', type: 'assistant.text', stream: 'stdout', level: 'info', payload: { text } };
}

const DEFAULT_COLS = 4;
const DEFAULT_ROWS = 4;
const ROWS_MAX = 8;

function colSpan(el: HTMLElement): number {
  return Number(el.style.gridColumn.replace('span ', ''));
}

function rowSpan(el: HTMLElement): number {
  return Number(el.style.gridRow.replace('span ', ''));
}

const stored = (): string | null => sessionStorage.getItem('conductor.live.cellSizes.ws1');

describe('Live page membership', () => {
  it('shows one cell per live worker on a ticket, and names the worker and the ticket', () => {
    state.workers = [
      agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'running' }),
      agent({ id: 'a2', name: 'Backend Engineer #1', ticketId: 'tk_2', status: 'active' }),
    ];
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode for the dashboard' }),
      ticket({ id: 'tk_2', identifier: 'ACME-7', title: 'Fix the flaky test' }),
    ];
    render(<LiveRoute />);
    expect(screen.getByText('Frontend Engineer #7')).toBeInTheDocument();
    expect(screen.getByText('Backend Engineer #1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ACME-42/ })).toHaveAttribute('href', '/w/ws1/tickets/ACME-42');
    expect(screen.getByRole('link', { name: /ACME-7/ })).toHaveAttribute('href', '/w/ws1/tickets/ACME-7');
    expect(screen.getByText('2 working')).toBeInTheDocument();
  });

  it('excludes paused, idle, retired workers and the conductor', () => {
    state.workers = [
      agent({ id: 'live', name: 'Frontend Engineer #7', status: 'running' }),
      agent({ id: 'paused', name: 'Paused #1', status: 'paused' }),
      agent({ id: 'done', name: 'Done #1', status: 'done' }),
      agent({ id: 'retired', name: 'Retired #1', status: 'retired' }),
      agent({ id: 'cond', name: 'Weaver', kind: 'weaver', status: 'running', ticketId: 'tk_1' }),
    ];
    state.tickets = [ticket({ id: 'tk_1', identifier: 'ACME-42' })];
    render(<LiveRoute />);
    expect(screen.getByText('Frontend Engineer #7')).toBeInTheDocument();
    expect(screen.queryByText('Paused #1')).not.toBeInTheDocument();
    expect(screen.queryByText('Done #1')).not.toBeInTheDocument();
    expect(screen.queryByText('Retired #1')).not.toBeInTheDocument();
    expect(screen.queryByText('Conductor')).not.toBeInTheDocument();
    expect(screen.getByText('1 working')).toBeInTheDocument();
  });

  it('says nobody is working when the loaded set is empty, without filling in paused workers', () => {
    state.workers = [agent({ id: 'paused', name: 'Paused #1', status: 'paused' })];
    render(<LiveRoute />);
    expect(screen.getByText('Nobody is working.')).toBeInTheDocument();
    expect(screen.queryByText('Paused #1')).not.toBeInTheDocument();
  });

  it('shows loading, not empty, while the working set has not arrived', () => {
    state.workers = undefined;
    render(<LiveRoute />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('Nobody is working.')).not.toBeInTheDocument();
  });

  it('shows an error with retry when the working set fails to load', () => {
    state.workers = undefined;
    state.workersError = true;
    render(<LiveRoute />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('WORKERS_QUERY_FAILED')).toBeInTheDocument();
    expect(screen.queryByText('Nobody is working.')).not.toBeInTheDocument();
  });
});

describe('Live page streaming', () => {
  it('opens a run stream for a worker with an in-progress run, and not for one between turns', () => {
    state.workers = [
      agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'running' }),
      agent({ id: 'a2', name: 'Backend Engineer #1', ticketId: 'tk_2', status: 'active' }),
    ];
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode' }),
      ticket({ id: 'tk_2', identifier: 'ACME-7', title: 'Flaky test' }),
    ];
    state.running = [makeRun({ id: 'run_1', agentId: 'a1', status: 'running' })];
    render(<LiveRoute />);

    expect(live().map((s) => s.url)).toEqual(['/api/w/ws1/events']);
    expect(screen.getByText('Waiting for the next turn.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ACME-7/ })).toBeInTheDocument();

    live()[0]!.emitRun({
      id: 'e1', runId: 'run_1', seq: 1, ts: '2026-09-01T09:00:00.000Z', type: 'assistant.text',
      stream: 'stdout', level: 'info', payload: { text: 'Reading the failing test.' },
    });
    expect(screen.getByText('Reading the failing test.')).toBeInTheDocument();
  });

  it('holds one shared stream for the whole floor, whatever the number of live tails (VS-417)', () => {
    state.workers = [
      agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'running' }),
      agent({ id: 'a2', name: 'Backend Engineer #1', ticketId: 'tk_2', status: 'running' }),
      agent({ id: 'a3', name: 'Platform Engineer #3', ticketId: 'tk_3', status: 'running' }),
    ];
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode' }),
      ticket({ id: 'tk_2', identifier: 'ACME-7', title: 'Flaky test' }),
      ticket({ id: 'tk_3', identifier: 'ACME-9', title: 'Slow chats' }),
    ];
    state.running = [
      makeRun({ id: 'run_1', agentId: 'a1', status: 'running' }),
      makeRun({ id: 'run_2', agentId: 'a2', status: 'running' }),
      makeRun({ id: 'run_3', agentId: 'a3', status: 'running' }),
    ];
    const { rerender } = render(<LiveRoute />);
    expect(live().map((s) => s.url)).toEqual(['/api/w/ws1/events']);

    state.workers = [
      agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'paused' }),
      agent({ id: 'a2', name: 'Backend Engineer #1', ticketId: 'tk_2', status: 'running' }),
      agent({ id: 'a3', name: 'Platform Engineer #3', ticketId: 'tk_3', status: 'running' }),
    ];
    rerender(<LiveRoute />);
    expect(live().map((s) => s.url)).toEqual(['/api/w/ws1/events']);
  });

  it('drops a cell when the worker leaves the live set, without a remount of the others', () => {
    state.workers = [
      agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'running' }),
      agent({ id: 'a2', name: 'Backend Engineer #1', ticketId: 'tk_2', status: 'running' }),
    ];
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode' }),
      ticket({ id: 'tk_2', identifier: 'ACME-7', title: 'Flaky test' }),
    ];
    const { rerender } = render(<LiveRoute />);
    expect(screen.getByText('Frontend Engineer #7')).toBeInTheDocument();
    expect(screen.getByText('Backend Engineer #1')).toBeInTheDocument();

    state.workers = [
      agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'paused' }),
      agent({ id: 'a2', name: 'Backend Engineer #1', ticketId: 'tk_2', status: 'running' }),
    ];
    rerender(<LiveRoute />);
    expect(screen.queryByText('Frontend Engineer #7')).not.toBeInTheDocument();
    expect(screen.getByText('Backend Engineer #1')).toBeInTheDocument();
    expect(screen.getByText('1 working')).toBeInTheDocument();
  });

  it('drops the last cell when its worker is done or retired, and says nobody is working (VS-172)', () => {
    state.workers = [agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'active' })];
    state.tickets = [ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode', status: 'done' })];
    const { rerender } = render(<LiveRoute />);
    expect(screen.getByText('Frontend Engineer #7')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the next turn.')).toBeInTheDocument();

    state.workers = [agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'done' })];
    rerender(<LiveRoute />);
    expect(screen.queryByText('Frontend Engineer #7')).not.toBeInTheDocument();
    expect(screen.getByText('Nobody is working.')).toBeInTheDocument();

    state.workers = [agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'retired' })];
    rerender(<LiveRoute />);
    expect(screen.queryByText('Frontend Engineer #7')).not.toBeInTheDocument();
    expect(screen.getByText('Nobody is working.')).toBeInTheDocument();
  });
});

describe('Live page worker model tier tag (VS-217)', () => {
  const opt = (id: string): WorkerModelOption => ({ id, description: `${id} tier`, runtime: 'claude', model: null });

  it('shows the ticket\'s option id in the cell when several options are configured', () => {
    state.workerOptions = [opt('quick'), opt('standard'), opt('deep')];
    twoWorkers();
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode', workerModelId: 'deep' }),
      ticket({ id: 'tk_2', identifier: 'ACME-7', title: 'Flaky test' }),
    ];
    render(<LiveRoute />);
    expect(within(cellOf('Frontend Engineer #7')).getByText('deep')).toBeInTheDocument();
    // A ticket on the workers default is labelled, not blank.
    expect(within(cellOf('Backend Engineer #1')).getByText('default')).toBeInTheDocument();
  });

  it('hides the tag when one option is configured', () => {
    state.workerOptions = [opt('quick')];
    twoWorkers();
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode', workerModelId: 'quick' }),
      ticket({ id: 'tk_2', identifier: 'ACME-7', title: 'Flaky test' }),
    ];
    render(<LiveRoute />);
    expect(screen.queryByText('quick')).not.toBeInTheDocument();
  });

  it('keeps the tag, agent name, ticket link and status on the smallest cell', () => {
    render(
      <LiveCell
        agent={agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'running' })}
        ticket={ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode', workerModelId: 'deep' })}
        run={null}
        size={{ cols: 1, rows: 1 }}
        colsMax={12}
        desktop
        onSize={() => undefined}
        workerOptions={[opt('quick'), opt('deep')]}
      />,
    );
    const cell = cellOf('Frontend Engineer #7');
    expect(colSpan(cell)).toBe(1);
    expect(within(cell).getByText('deep')).toBeInTheDocument();
    expect(within(cell).getByRole('link', { name: /ACME-42/ })).toBeInTheDocument();
    expect(within(cell).getByRole('img')).toBeInTheDocument();
  });
});

describe('Live page desktop resize', () => {
  beforeEach(() => stubSm());

  it('grows then shrinks a cell by dragging its handle, and neighbours stay', () => {
    twoWorkers();
    render(<LiveRoute />);
    const cell = cellOf('Frontend Engineer #7');
    const other = cellOf('Backend Engineer #1');
    expect(colSpan(cell)).toBe(DEFAULT_COLS);
    layout(cell);
    const handle = screen.getByLabelText('Resize Frontend Engineer #7');
    expect(handle).toHaveClass('touch-none');

    // unitW = 200/4 = 50; dx=100 crosses two tracks: 4 -> 6.
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200, clientY: 150 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 150 });
    expect(colSpan(cell)).toBe(6);
    expect(other).toBeInTheDocument();

    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(stored()).toContain('"a1"');

    // unitW = 200/6 ≈ 33.3; dx=-67 crosses back two tracks: 6 -> 4 (the equal slot).
    layout(cell);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200, clientY: 150 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 133, clientY: 150 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(colSpan(cell)).toBe(DEFAULT_COLS);
  });

  it('writes nothing when the handle is pressed and released without moving', () => {
    twoWorkers();
    render(<LiveRoute />);
    layout(cellOf('Frontend Engineer #7'));
    const handle = screen.getByLabelText('Resize Frontend Engineer #7');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200, clientY: 150 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(colSpan(cellOf('Frontend Engineer #7'))).toBe(DEFAULT_COLS);
    expect(stored()).toBeNull();
  });

  it('resets to the equal slot on double-click', () => {
    twoWorkers();
    render(<LiveRoute />);
    const cell = cellOf('Frontend Engineer #7');
    layout(cell);
    const handle = screen.getByLabelText('Resize Frontend Engineer #7');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200, clientY: 150 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 150 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(colSpan(cell)).toBe(6);
    fireEvent.doubleClick(handle);
    expect(colSpan(cell)).toBe(DEFAULT_COLS);
  });

  it('restores the chosen size after a reload in the same session', () => {
    sessionStorage.setItem('conductor.live.cellSizes.ws1', JSON.stringify({ a1: { cols: 6, rows: 3 } }));
    twoWorkers();
    render(<LiveRoute />);
    expect(colSpan(cellOf('Frontend Engineer #7'))).toBe(6);
    expect(colSpan(cellOf('Backend Engineer #1'))).toBe(DEFAULT_COLS);
  });

  it('offers no handle on empty or loading', () => {
    state.workers = undefined;
    render(<LiveRoute />);
    expect(screen.queryByLabelText(/Resize/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument();
  });
});

describe('Live page phone expand', () => {
  it('offers expand, not drag, and toggling it enlarges then restores the transcript', () => {
    twoWorkers();
    state.running = [makeRun({ id: 'run_1', agentId: 'a1', status: 'running' })];
    render(<LiveRoute />);
    expect(screen.queryByLabelText(/Resize/)).not.toBeInTheDocument();
    const expand = screen.getAllByRole('button', { name: 'Expand' })[0]!;
    const cell = cellOf('Frontend Engineer #7');
    expect(rowSpan(cell)).toBe(DEFAULT_ROWS);
    expect(cell.style.getPropertyValue('--ac-cell-rows')).toBe('1');
    expect(screen.getByLabelText('Transcript of Frontend Engineer #7')).toHaveClass('ac-live-transcript');

    fireEvent.click(expand);
    expect(rowSpan(cell)).toBe(ROWS_MAX);
    expect(cell.style.getPropertyValue('--ac-cell-rows')).toBe('2');
    expect(cellOf('Backend Engineer #1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(rowSpan(cell)).toBe(DEFAULT_ROWS);
    expect(cell.style.getPropertyValue('--ac-cell-rows')).toBe('1');
  });

  it('offers neither expand nor drag on empty or loading', () => {
    state.workers = [];
    render(<LiveRoute />);
    expect(screen.getByText('Nobody is working.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Resize/)).not.toBeInTheDocument();
  });
});

describe('Live page keeps the last turn (VS-332)', () => {
  function finishedWorker(): void {
    state.workers = [agent({ id: 'a1', name: 'Frontend Engineer #7', ticketId: 'tk_1', status: 'active' })];
    state.tickets = [ticket({ id: 'tk_1', identifier: 'ACME-42', title: 'Dark mode' })];
  }

  it('shows the most recent finished run with the waiting footer, and opens no stream', () => {
    finishedWorker();
    state.recent = [makeRun({ id: 'run_1', agentId: 'a1', status: 'succeeded', finishedAt: '2026-09-01T09:05:00.000Z' })];
    state.persistedNewest = [evt(1, 'Reading the failing test.')];
    render(<LiveRoute />);

    expect(live()).toEqual([]);
    expect(within(cellOf('Frontend Engineer #7')).getByText('Reading the failing test.')).toBeInTheDocument();
    expect(screen.getByLabelText('Transcript of Frontend Engineer #7')).toHaveClass('ac-live-transcript');
    expect(screen.getByText('Waiting for the next turn.')).toBeInTheDocument();
  });

  it('shows only the waiting line for a worker that has never run', () => {
    finishedWorker();
    render(<LiveRoute />);
    expect(screen.getByText('Waiting for the next turn.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Transcript of Frontend Engineer #7')).not.toBeInTheDocument();
    expect(live()).toEqual([]);
  });

  it('renders the ending of a finished run longer than one page, not its first events', () => {
    finishedWorker();
    state.recent = [makeRun({ id: 'run_1', agentId: 'a1', status: 'succeeded', finishedAt: '2026-09-01T09:05:00.000Z' })];
    // The head page is what an unfixed read would show; the newest page is what must render.
    state.persisted = [evt(1, 'Opening line.')];
    state.persistedNewest = [evt(999, 'Final line.')];
    render(<LiveRoute />);

    expect(screen.getByText('Final line.')).toBeInTheDocument();
    expect(screen.queryByText('Opening line.')).not.toBeInTheDocument();
  });

  it('keeps the transcript on screen and adds the footer when a run finishes', () => {
    finishedWorker();
    state.running = [makeRun({ id: 'run_1', agentId: 'a1', status: 'running' })];
    const { rerender } = render(<LiveRoute />);
    live()[0]!.emitRun(evt(1, 'Still working.'));
    expect(screen.getByText('Still working.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for the next turn.')).not.toBeInTheDocument();

    state.running = [];
    state.recent = [makeRun({ id: 'run_1', agentId: 'a1', status: 'succeeded', finishedAt: '2026-09-01T09:05:00.000Z' })];
    rerender(<LiveRoute />);

    expect(screen.getByText('Still working.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the next turn.')).toBeInTheDocument();
    expect(live()).toEqual([]);
  });

  it('keeps the finished transcript while the next run warms up, then switches to its stream', () => {
    finishedWorker();
    state.recent = [makeRun({ id: 'run_1', agentId: 'a1', status: 'succeeded', finishedAt: '2026-09-01T09:05:00.000Z' })];
    state.persistedNewest = [evt(1, 'First turn.')];
    const { rerender } = render(<LiveRoute />);
    expect(screen.getByText('First turn.')).toBeInTheDocument();

    state.running = [makeRun({ id: 'run_2', agentId: 'a1', status: 'running' })];
    state.recent = [makeRun({ id: 'run_2', agentId: 'a1', status: 'running' })];
    state.persisted = [];
    rerender(<LiveRoute />);

    expect(live().map((s) => s.url)).toEqual(['/api/w/ws1/events']);
    expect(screen.getByText('First turn.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for the next turn.')).not.toBeInTheDocument();

    live()[0]!.emitRun(evt(1, 'New turn.', 'run_2'));
    expect(screen.getByText('New turn.')).toBeInTheDocument();
  });

  it('opens one shared stream for the running cells, never one for a finished-run cell (VS-417)', () => {
    state.workers = [
      agent({ id: 'a1', name: 'Finished #1', ticketId: 'tk_1', status: 'active', createdAt: '2026-09-01T09:03:00.000Z' }),
      agent({ id: 'a2', name: 'Running #1', ticketId: 'tk_2', status: 'running', createdAt: '2026-09-01T09:02:00.000Z' }),
      agent({ id: 'a3', name: 'Running #2', ticketId: 'tk_3', status: 'running', createdAt: '2026-09-01T09:01:00.000Z' }),
    ];
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'ACME-42' }),
      ticket({ id: 'tk_2', identifier: 'ACME-7' }),
      ticket({ id: 'tk_3', identifier: 'ACME-9' }),
    ];
    state.recent = [
      makeRun({ id: 'run_1', agentId: 'a1', status: 'succeeded', createdAt: '2026-09-01T09:03:00.000Z' }),
      makeRun({ id: 'run_2', agentId: 'a2', status: 'running', createdAt: '2026-09-01T09:02:00.000Z' }),
      makeRun({ id: 'run_3', agentId: 'a3', status: 'running', createdAt: '2026-09-01T09:01:00.000Z' }),
    ];
    state.running = [
      makeRun({ id: 'run_2', agentId: 'a2', status: 'running' }),
      makeRun({ id: 'run_3', agentId: 'a3', status: 'running' }),
    ];
    render(<LiveRoute />);

    expect(live().map((s) => s.url)).toEqual(['/api/w/ws1/events']);
  });
});

describe('Live page running-first order (VS-337)', () => {
  function runningAndWaiting(): void {
    state.workers = [
      agent({ id: 'a1', name: 'Runner', ticketId: 'tk_1', status: 'running', createdAt: '2026-09-01T00:00:00.000Z' }),
      agent({ id: 'a2', name: 'Waiting', ticketId: 'tk_2', status: 'active', createdAt: '2026-09-02T00:00:00.000Z' }),
    ];
    state.tickets = [ticket({ id: 'tk_1', identifier: 'ACME-1' }), ticket({ id: 'tk_2', identifier: 'ACME-2' })];
    state.running = [makeRun({ id: 'run_1', agentId: 'a1', status: 'running' })];
    state.recent = [makeRun({ id: 'run_1', agentId: 'a1', status: 'running' })];
  }

  it('renders running cells before waiting cells, newest first within each group', () => {
    state.workers = [
      agent({ id: 'r-old', name: 'Running Old', ticketId: 'tk_1', status: 'running', createdAt: '2026-09-01T00:00:00.000Z' }),
      agent({ id: 'w-new', name: 'Waiting New', ticketId: 'tk_2', status: 'active', createdAt: '2026-09-04T00:00:00.000Z' }),
      agent({ id: 'r-new', name: 'Running New', ticketId: 'tk_3', status: 'running', createdAt: '2026-09-03T00:00:00.000Z' }),
      agent({ id: 'w-old', name: 'Waiting Old', ticketId: 'tk_4', status: 'active', createdAt: '2026-09-02T00:00:00.000Z' }),
    ];
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'ACME-1' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2' }),
      ticket({ id: 'tk_3', identifier: 'ACME-3' }),
      ticket({ id: 'tk_4', identifier: 'ACME-4' }),
    ];
    state.running = [
      makeRun({ id: 'run_old', agentId: 'r-old', status: 'running' }),
      makeRun({ id: 'run_new', agentId: 'r-new', status: 'running' }),
    ];
    render(<LiveRoute />);

    // The waiting worker is newest overall, yet every running cell is above it.
    expect(cellNames()).toEqual(['Running New', 'Running Old', 'Waiting New', 'Waiting Old']);
  });

  it('keeps a finished cell in place for the grace window, then moves it down', () => {
    vi.useFakeTimers();
    try {
      runningAndWaiting();
      const { rerender } = render(<LiveRoute />);
      expect(cellNames()).toEqual(['Runner', 'Waiting']);

      state.running = [];
      state.recent = [makeRun({ id: 'run_1', agentId: 'a1', status: 'succeeded', finishedAt: '2026-09-01T09:05:00.000Z' })];
      rerender(<LiveRoute />);
      expect(cellNames()).toEqual(['Runner', 'Waiting']);

      act(() => vi.advanceTimersByTime(LIVE_RUN_GRACE_MS - 1));
      expect(cellNames()).toEqual(['Runner', 'Waiting']);

      act(() => vi.advanceTimersByTime(1));
      expect(cellNames()).toEqual(['Waiting', 'Runner']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a cell in place when a new run starts inside the grace window', () => {
    vi.useFakeTimers();
    try {
      runningAndWaiting();
      const { rerender } = render(<LiveRoute />);

      state.running = [];
      state.recent = [makeRun({ id: 'run_1', agentId: 'a1', status: 'succeeded' })];
      rerender(<LiveRoute />);
      act(() => vi.advanceTimersByTime(LIVE_RUN_GRACE_MS / 2));

      state.running = [makeRun({ id: 'run_2', agentId: 'a1', status: 'running' })];
      state.recent = [makeRun({ id: 'run_2', agentId: 'a1', status: 'running' })];
      rerender(<LiveRoute />);

      act(() => vi.advanceTimersByTime(LIVE_RUN_GRACE_MS));
      expect(cellNames()).toEqual(['Runner', 'Waiting']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the run-tail slots on the canonical order, unaffected by the reorder', () => {
    state.workers = [
      agent({ id: 'a1', name: 'Running Old', ticketId: 'tk_1', status: 'running', createdAt: '2026-09-01T00:00:00.000Z' }),
      agent({ id: 'a2', name: 'Running New', ticketId: 'tk_2', status: 'running', createdAt: '2026-09-02T00:00:00.000Z' }),
      agent({ id: 'a3', name: 'Waiting New', ticketId: 'tk_3', status: 'active', createdAt: '2026-09-03T00:00:00.000Z' }),
    ];
    state.tickets = [
      ticket({ id: 'tk_1', identifier: 'ACME-1' }),
      ticket({ id: 'tk_2', identifier: 'ACME-2' }),
      ticket({ id: 'tk_3', identifier: 'ACME-3' }),
    ];
    state.running = [
      makeRun({ id: 'run_1', agentId: 'a1', status: 'running' }),
      makeRun({ id: 'run_2', agentId: 'a2', status: 'running' }),
    ];
    render(<LiveRoute />);

    // One shared stream for the floor, whatever the reorder.
    expect(live().map((s) => s.url)).toEqual(['/api/w/ws1/events']);
    expect(cellNames()).toEqual(['Running New', 'Running Old', 'Waiting New']);
  });

  it('does not drop or reopen a running cell’s stream when the order changes', () => {
    state.workers = [agent({ id: 'a1', name: 'Runner', ticketId: 'tk_1', status: 'running', createdAt: '2026-09-01T00:00:00.000Z' })];
    state.tickets = [ticket({ id: 'tk_1', identifier: 'ACME-1' })];
    state.running = [makeRun({ id: 'run_1', agentId: 'a1', status: 'running' })];
    const { rerender } = render(<LiveRoute />);
    const stream = live()[0]!;

    // A newer waiting worker arrives; running-first keeps the runner on top rather than below it.
    runningAndWaiting();
    rerender(<LiveRoute />);

    expect(cellNames()).toEqual(['Runner', 'Waiting']);
    expect(live()).toEqual([stream]);
    expect(stream.closed).toBe(false);
  });

  it('keeps a moved cell’s saved size', () => {
    stubSm();
    sessionStorage.setItem('conductor.live.cellSizes.ws1', JSON.stringify({ a1: { cols: 6, rows: 3 } }));
    state.workers = [
      agent({ id: 'a1', name: 'Waiting Sized', ticketId: 'tk_1', status: 'active', createdAt: '2026-09-02T00:00:00.000Z' }),
      agent({ id: 'a2', name: 'Running', ticketId: 'tk_2', status: 'running', createdAt: '2026-09-01T00:00:00.000Z' }),
    ];
    state.tickets = [ticket({ id: 'tk_1', identifier: 'ACME-1' }), ticket({ id: 'tk_2', identifier: 'ACME-2' })];
    state.running = [makeRun({ id: 'run_1', agentId: 'a2', status: 'running' })];
    render(<LiveRoute />);

    // a1 is newest in the canonical order, so it starts on top and the reorder moves it below a2.
    expect(cellNames()).toEqual(['Running', 'Waiting Sized']);
    expect(colSpan(cellOf('Waiting Sized'))).toBe(6);
  });
});


