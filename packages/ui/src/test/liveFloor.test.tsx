/**
 * VS-152: the Live page is a grid of currently-working workers, each streaming its run.
 * VS-164: cells drag-resize on desktop and expand by tap on the phone.
 * VS-206: spans are fine `gridColumn`/`gridRow` inline style, not `col-span-N` classes; a cell's
 * `--ac-cell-rows` custom property (its row span normalized to GRANULARITY units) drives the
 * transcript's proportional max-height instead of a class name carrying the fraction.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Run, RunEvent, Ticket } from '@agent-conductor/shared';
import { agent, run as makeRun, ticket } from './factories';

const state = vi.hoisted(() => ({
  workers: undefined as Agent[] | undefined,
  workersError: false,
  tickets: [] as Ticket[],
  running: [] as Run[],
  queued: [] as Run[],
  persisted: [] as RunEvent[],
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
  useRuns: (params: { status?: string } = {}) => ({
    data: params.status === 'queued' ? state.queued : params.status === 'running' ? state.running : [...state.queued, ...state.running],
    isLoading: false,
  }),
  useRunEvents: (id: string) => ({ data: id ? state.persisted : [], isLoading: false }),
}));

const { LiveRoute } = await import('../routes/Live');

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
  state.running = [];
  state.queued = [];
  state.persisted = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = ((q: string) => ({ ...phoneMedia(), media: q })) as unknown as typeof window.matchMedia;
});
afterEach(() => vi.clearAllMocks());

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
      agent({ id: 'cond', name: 'Conductor', kind: 'conductor', status: 'running', ticketId: 'tk_1' }),
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

    expect(live().map((s) => s.url)).toEqual(['/api/w/ws1/runs/run_1/events/stream']);
    expect(screen.getByText('Waiting for the next turn.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ACME-7/ })).toBeInTheDocument();

    live()[0]!.emit({
      id: 'e1', runId: 'run_1', seq: 1, ts: '2026-09-01T09:00:00.000Z', type: 'assistant.text',
      stream: 'stdout', level: 'info', payload: { text: 'Reading the failing test.' },
    });
    expect(screen.getByText('Reading the failing test.')).toBeInTheDocument();
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

