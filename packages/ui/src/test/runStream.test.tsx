/**
 * VS-417: a run's live tail rides the one workspace event stream, not a per-run `EventSource`, and
 * a run hook merges that tail with the persisted read by `seq`.
 *
 * The connection-state machine itself (backoff ladder, offline vs. reconnecting, the online fast
 * path) is covered exhaustively in `sseStream.test.tsx`; `EventStream`'s own machine is covered in
 * `eventStream.test.tsx`. These cases prove the run-side wiring: the shared subscription, the
 * per-run filter, the merge, and the reconnect refetch.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { resetWorkspaceStreams } from '../api/streams';

const persisted = vi.hoisted(() => ({ data: [] as RunEvent[] }));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../api/hooks', () => ({ useRunEvents: (id: string) => (id ? persisted : { data: [] }) }));

const { useRunEventStream, mergeRunEvents } = await import('../api/runStream');

function ev(over: Partial<RunEvent> & Pick<RunEvent, 'id' | 'seq'>): RunEvent {
  return {
    runId: 'run1', ts: '2026-09-01T09:00:00.000Z', stream: 'stdout', level: 'info',
    type: 'assistant.text', payload: { text: over.id }, ...over,
  };
}

/** A controllable EventSource: the daemon names every frame, so tests emit named events. */
class FakeEventSource {
  static open: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(m: MessageEvent<string>) => void>>();
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.open.push(this);
  }
  addEventListener(type: string, fn: (m: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  close(): void { this.closed = true; }

  /** A `run.event` workspace frame, as the daemon broadcasts it. */
  emitRun(event: RunEvent): void {
    const frame = { seq: 0, workspaceId: 'ws1', type: 'run.event', entityType: 'run', entityId: event.runId, payload: { runId: event.runId, event }, createdAt: '' };
    for (const fn of this.listeners.get('run.event') ?? []) fn({ data: JSON.stringify(frame) } as MessageEvent<string>);
  }
  connect(): void { this.onopen?.(); }
  fail(): void { this.onerror?.(); }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.open = [];
  persisted.data = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});
afterEach(() => {
  resetWorkspaceStreams();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const last = (): FakeEventSource => FakeEventSource.open[FakeEventSource.open.length - 1]!;

describe('mergeRunEvents', () => {
  it('keeps two events with different seq', () => {
    const out = mergeRunEvents([ev({ id: 'e1', seq: 1 })], [ev({ id: 'e2', seq: 2 })]);
    expect(out.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('collapses a row present in both inputs with the same seq but a different id', () => {
    // The real shape (VS-319): a persisted row's id is the database's own autoincrement id, a
    // live emission's id is `String(seq)` — the two never agree, `seq` does.
    const out = mergeRunEvents([ev({ id: '4821', seq: 1 })], [ev({ id: '1', seq: 1 })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.seq).toBe(1);
  });

  it('orders the result by seq regardless of input order', () => {
    const out = mergeRunEvents([ev({ id: 'e3', seq: 3 }), ev({ id: 'e1', seq: 1 })], [ev({ id: 'e2', seq: 2 })]);
    expect(out.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe('useRunEventStream', () => {
  it('opens the workspace stream, not a per-run one, and appends that run’s frames', () => {
    const { result } = renderHook(() => useRunEventStream('run1'));
    expect(FakeEventSource.open).toHaveLength(1);
    expect(last().url).toBe('/api/w/ws1/events');
    expect(result.current.events).toEqual([]);

    act(() => { last().emitRun(ev({ id: 'e1', seq: 1 })); });
    act(() => { last().emitRun(ev({ id: 'e2', seq: 2, type: 'tool.call', payload: { id: 't1', name: 'Read' } })); });
    expect(result.current.events.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('ignores frames belonging to another run on the shared stream', () => {
    const { result } = renderHook(() => useRunEventStream('run1'));
    act(() => { last().emitRun(ev({ id: 'other', seq: 5, runId: 'run2' })); });
    expect(result.current.events).toEqual([]);
  });

  it('opens nothing without a run, and takes nothing when not live', () => {
    renderHook(() => useRunEventStream(null));
    renderHook(() => useRunEventStream('run1', { live: false }));
    expect(FakeEventSource.open).toHaveLength(0);
  });

  it('merges the persisted rows with the live tail, de-duplicated by seq and ordered', () => {
    persisted.data = [ev({ id: 'e1', seq: 1 }), ev({ id: 'e2', seq: 2 })];
    const { result } = renderHook(() => useRunEventStream('run1'));
    expect(result.current.events.map((e) => e.id)).toEqual(['e1', 'e2']);

    act(() => { last().emitRun(ev({ id: 'e2', seq: 2 })); });
    act(() => { last().emitRun(ev({ id: 'e3', seq: 3 })); });
    expect(result.current.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('shares one source across many run hooks in a workspace (VS-417)', () => {
    const a = renderHook(() => useRunEventStream('run1'));
    const b = renderHook(() => useRunEventStream('run2'));
    const c = renderHook(() => useRunEventStream('run1'));

    expect(FakeEventSource.open).toHaveLength(1);
    act(() => {
      last().connect();
      last().emitRun(ev({ id: '1', seq: 1, runId: 'run1' }));
      last().emitRun(ev({ id: '2', seq: 1, runId: 'run2' }));
    });
    expect(a.result.current.events.map((e) => e.id)).toEqual(['1']);
    expect(b.result.current.events.map((e) => e.id)).toEqual(['2']);
    expect(c.result.current.events.map((e) => e.id)).toEqual(['1']);
  });

  it('keeps the shared stream open when one run unsubscribes, for the others (VS-417)', () => {
    const a = renderHook(() => useRunEventStream('run1'));
    const b = renderHook(() => useRunEventStream('run2'));
    const shared = last();
    act(() => { shared.connect(); });

    b.unmount();
    expect(shared.closed).toBe(false);
    expect(FakeEventSource.open).toHaveLength(1);

    act(() => { last().emitRun(ev({ id: '1', seq: 1, runId: 'run1' })); });
    expect(a.result.current.events.map((e) => e.id)).toEqual(['1']);
  });

  it('reports the shared stream’s status and reconnects on retryNow', () => {
    const { result } = renderHook(() => useRunEventStream('run1'));
    expect(result.current.status.state).toBe('connecting');
    act(() => { last().connect(); });
    expect(result.current.status.state).toBe('connected');

    act(() => { last().fail(); });
    expect(FakeEventSource.open).toHaveLength(1);
    act(() => { result.current.retryNow(); });
    expect(FakeEventSource.open).toHaveLength(2);
  });

  it('refetches the run’s persisted events after a reconnect, so a missed frame is recovered', () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    renderHook(() => useRunEventStream('run1'), { wrapper });

    act(() => { last().connect(); });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => { last().fail(); });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { last().connect(); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['w', 'ws1', 'runs', 'run1', 'events'] });
  });
});
