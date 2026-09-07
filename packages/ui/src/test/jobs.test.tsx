/** The job progress component and the job stream hook (VS-37). */
import { act, renderHook } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobLogLine, JobStep } from '@agent-conductor/shared';
import { JobProgress } from '../components/JobProgress';
import { useJobStream } from '../api/jobStream';

const T0 = '2026-09-05T10:00:00.000Z';
const at = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString();

const step = (id: string, label: string, state: JobStep['state'], span?: [number, number]): JobStep => ({
  id, label, state,
  startedAt: span ? at(span[0]) : null,
  endedAt: span && state !== 'running' ? at(span[1]) : null,
});
const line = (seq: number, stepId: string, text: string): JobLogLine => ({ seq, step: stepId, stream: 'stderr', text });

describe('JobProgress', () => {
  it('names the running sub-step, its elapsed time and its live output', () => {
    render(
      <JobProgress
        steps={[step('clone', 'Clone the repository', 'running', [0, 0]), step('declare', 'Declare the project', 'pending')]}
        log={[line(1, 'clone', 'Receiving objects: 40%'), line(2, 'clone', 'Receiving objects: 90%')]}
        now={Date.parse(T0) + 12_000}
      />,
    );
    expect(screen.getByText('Clone the repository')).toBeInTheDocument();
    expect(screen.getByText('Declare the project')).toBeInTheDocument();
    expect(screen.getByText('12s')).toBeInTheDocument();
    expect(screen.getByText(/Receiving objects: 90%/)).toBeInTheDocument();
  });

  it('keeps the duration of a finished step and marks one that had nothing to do', () => {
    render(
      <JobProgress
        steps={[step('clone', 'Clone the repository', 'done', [0, 3400]), step('openspec', 'Adopt OpenSpec', 'skipped', [3400, 3400])]}
        log={[]}
        now={Date.parse(T0) + 90_000}
      />,
    );
    expect(screen.getByText('3.4s')).toBeInTheDocument();
    expect(screen.getByText('skipped')).toBeInTheDocument();
  });

  it('shows the failing sub-step with its last lines rather than a bare failed state', () => {
    render(
      <JobProgress
        steps={[step('clone', 'Clone the repository', 'failed', [0, 500]), step('declare', 'Declare the project', 'pending')]}
        log={[line(1, 'clone', 'Cloning into /ws/projects/api…'), line(2, 'clone', 'fatal: repository not found'), line(3, 'other', 'unrelated')]}
        failedStep="clone"
        message="git clone failed"
      />,
    );
    expect(screen.getByText('git clone failed')).toBeInTheDocument();
    const tail = screen.getByText(/fatal: repository not found/);
    expect(tail).toBeInTheDocument();
    expect(tail.textContent).not.toContain('unrelated');
  });

  it('renders nothing before the job has any steps', () => {
    const { container } = render(<JobProgress steps={[]} log={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/** A controllable EventSource; the daemon names every job frame. */
class FakeEventSource {
  static open: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(m: MessageEvent<string>) => void>>();
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.open.push(this); }
  addEventListener(type: string, fn: (m: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void { this.closed = true; }
  emit(type: string, payload: unknown): void {
    const m = { data: JSON.stringify(payload) } as MessageEvent<string>;
    for (const fn of this.listeners.get(type) ?? []) fn(m);
  }
  connect(): void { this.onopen?.(); }
  fail(): void { this.onerror?.(); }
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.open = [];
  setOnline(true);
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

const last = (): FakeEventSource => FakeEventSource.open[FakeEventSource.open.length - 1]!;

describe('useJobStream', () => {
  it('opens the job stream and folds steps and lines in as they arrive', () => {
    const { result } = renderHook(() => useJobStream('ws1', 'j1'));
    expect(last().url).toBe('/api/w/ws1/jobs/j1/stream');
    expect(result.current.job).toBeNull();

    act(() => { last().emit('job.step', { kind: 'step', jobId: 'j1', seq: 0, step: step('clone', 'Clone the repository', 'running', [0, 0]) }); });
    expect(result.current.job?.steps.map((s) => s.id)).toEqual(['clone']);

    act(() => { last().emit('job.log', { kind: 'log', jobId: 'j1', seq: 1, line: line(1, 'clone', 'Receiving objects: 40%') }); });
    expect(result.current.job?.log.map((l) => l.text)).toEqual(['Receiving objects: 40%']);

    act(() => { last().emit('job.step', { kind: 'step', jobId: 'j1', seq: 1, step: step('clone', 'Clone the repository', 'done', [0, 900]) }); });
    expect(result.current.job?.steps[0]!.state).toBe('done');
    expect(result.current.job?.steps).toHaveLength(1);
  });

  it('takes the final record from the finish frame', () => {
    const { result } = renderHook(() => useJobStream('ws1', 'j1'));
    const job: Job = {
      id: 'j1', workspaceId: 'ws1', kind: 'project_add', entityType: 'project', entityId: 'p1', state: 'failed',
      steps: [step('clone', 'Clone the repository', 'failed', [0, 500])],
      log: [line(1, 'clone', 'fatal: repository not found')], logSeq: 1, requestedBy: 'human:op1',
      startedAt: T0, finishedAt: at(500), failedStep: 'clone', message: 'git clone failed',
    };
    act(() => { last().emit('job.finished', { kind: 'finished', jobId: 'j1', seq: 1, job }); });
    expect(result.current.job).toMatchObject({ state: 'failed', failedStep: 'clone', message: 'git clone failed' });
  });

  it('resumes after the highest seq it saw and never duplicates a line', () => {
    const { result } = renderHook(() => useJobStream('ws1', 'j1'));
    act(() => { last().emit('job.log', { kind: 'log', jobId: 'j1', seq: 4, line: line(4, 'clone', 'four') }); });
    act(() => { last().fail(); });
    act(() => { vi.advanceTimersByTime(600); });
    expect(last().url).toBe('/api/w/ws1/jobs/j1/stream?after=4');

    act(() => { last().emit('job.log', { kind: 'log', jobId: 'j1', seq: 4, line: line(4, 'clone', 'four') }); });
    expect(result.current.job?.log).toHaveLength(1);
  });

  it('opens nothing without a job', () => {
    const { result } = renderHook(() => useJobStream('ws1', null));
    expect(FakeEventSource.open).toHaveLength(0);
    expect(result.current.job).toBeNull();
  });
});

/**
 * The connection-state machine itself is covered exhaustively in `sseStream.test.tsx`. These cases
 * prove the wiring: that `useJobStream` surfaces that same state and that its own URL/seq logic
 * keeps working through a drop and a manual retry.
 */
describe('useJobStream connection state', () => {
  it('reports connecting, then connected once the stream opens', () => {
    const { result } = renderHook(() => useJobStream('ws1', 'j1'));
    expect(result.current.status.state).toBe('connecting');
    act(() => { last().connect(); });
    expect(result.current.status.state).toBe('connected');
  });

  it('reports reconnecting on a drop while online, and offline while the device is offline', () => {
    const { result } = renderHook(() => useJobStream('ws1', 'j1'));
    act(() => { last().connect(); last().fail(); });
    expect(result.current.status.state).toBe('reconnecting');

    setOnline(false);
    const { result: r2 } = renderHook(() => useJobStream('ws1', 'j2'));
    act(() => { last().fail(); });
    expect(r2.current.status.state).toBe('offline');
  });

  it('reconnects at once on the browser online event', () => {
    renderHook(() => useJobStream('ws1', 'j1'));
    act(() => { last().connect(); last().fail(); });
    expect(FakeEventSource.open).toHaveLength(1);

    act(() => { window.dispatchEvent(new Event('online')); });
    expect(FakeEventSource.open).toHaveLength(2);
  });

  it('retryNow reopens immediately, carrying the last seq seen', () => {
    const { result } = renderHook(() => useJobStream('ws1', 'j1'));
    act(() => { last().connect(); });
    act(() => { last().emit('job.log', { kind: 'log', jobId: 'j1', seq: 3, line: line(3, 'clone', 'three') }); });
    act(() => { last().fail(); });
    expect(FakeEventSource.open).toHaveLength(1);

    act(() => { result.current.retryNow(); });
    expect(FakeEventSource.open).toHaveLength(2);
    expect(last().url).toBe('/api/w/ws1/jobs/j1/stream?after=3');
  });
});
