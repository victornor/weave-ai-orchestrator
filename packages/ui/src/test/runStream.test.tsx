import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';

const persisted = vi.hoisted(() => ({ data: [] as RunEvent[] }));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));
vi.mock('../api/hooks', () => ({ useRunEvents: (id: string) => (id ? persisted : { data: [] }) }));

const { useRunEventStream } = await import('../api/runStream');

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

  emit(event: RunEvent): void {
    const m = { data: JSON.stringify(event) } as MessageEvent<string>;
    for (const fn of this.listeners.get(event.type) ?? []) fn(m);
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
  persisted.data = [];
  setOnline(true);
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

const last = () => FakeEventSource.open[FakeEventSource.open.length - 1]!;

describe('useRunEventStream', () => {
  it('opens the run stream and appends frames as they arrive', () => {
    const { result } = renderHook(() => useRunEventStream('run1'));
    expect(FakeEventSource.open).toHaveLength(1);
    expect(last().url).toBe('/api/w/ws1/runs/run1/events/stream');
    expect(result.current.events).toEqual([]);

    act(() => { last().emit(ev({ id: 'e1', seq: 1 })); });
    act(() => { last().emit(ev({ id: 'e2', seq: 2, type: 'tool.call', payload: { id: 't1', name: 'Read' } })); });
    expect(result.current.events.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('opens nothing without a run, and closes the stream when the run clears', () => {
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useRunEventStream(id), {
      initialProps: { id: null as string | null },
    });
    expect(FakeEventSource.open).toHaveLength(0);
    expect(result.current.events).toEqual([]);

    rerender({ id: 'run1' });
    expect(FakeEventSource.open).toHaveLength(1);
    act(() => { last().emit(ev({ id: 'e1', seq: 1 })); });
    expect(result.current.events).toHaveLength(1);

    const opened = last();
    rerender({ id: null });
    expect(opened.closed).toBe(true);
    expect(result.current.events).toEqual([]);
  });

  it('merges the persisted rows with the live tail, de-duplicated by id and ordered by seq', () => {
    persisted.data = [ev({ id: 'e1', seq: 1 }), ev({ id: 'e2', seq: 2 })];
    const { result } = renderHook(() => useRunEventStream('run1'));
    expect(result.current.events.map((e) => e.id)).toEqual(['e1', 'e2']);

    // The stream replays before it tails, so the first frames overlap what the query returned.
    act(() => { last().emit(ev({ id: 'e2', seq: 2 })); });
    act(() => { last().emit(ev({ id: 'e3', seq: 3 })); });
    expect(result.current.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('reconnects after an error, resuming from the highest seq without duplicating the overlap', () => {
    const { result } = renderHook(() => useRunEventStream('run1'));
    act(() => { last().emit(ev({ id: 'e1', seq: 1 })); });
    act(() => { last().emit(ev({ id: 'e2', seq: 2 })); });

    const dropped = last();
    act(() => { dropped.fail(); });
    expect(dropped.closed).toBe(true);
    expect(FakeEventSource.open).toHaveLength(1);

    act(() => { vi.advanceTimersByTime(500); });
    expect(FakeEventSource.open).toHaveLength(2);
    expect(last().url).toBe('/api/w/ws1/runs/run1/events/stream?after=2');

    // The replay repeats e2 and carries what we missed while disconnected.
    act(() => { last().emit(ev({ id: 'e2', seq: 2 })); });
    act(() => { last().emit(ev({ id: 'e3', seq: 3 })); });
    expect(result.current.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('ignores an unparseable frame', () => {
    const { result } = renderHook(() => useRunEventStream('run1'));
    act(() => {
      for (const fn of last().listeners.get('assistant.text') ?? []) fn({ data: 'not json' } as MessageEvent<string>);
    });
    expect(result.current.events).toEqual([]);
  });
});

/**
 * The connection-state machine itself (backoff ladder, offline vs. reconnecting, the online fast
 * path, retryNow) is covered exhaustively in `sseStream.test.tsx` against `useLiveStream` directly.
 * These cases only prove the wiring: that `useRunEventStream` surfaces that same state and that its
 * own URL/seq logic keeps working through a drop and a manual retry.
 */
describe('useRunEventStream connection state', () => {
  it('reports connecting, then connected once the stream opens', () => {
    const { result } = renderHook(() => useRunEventStream('run1'));
    expect(result.current.status.state).toBe('connecting');
    act(() => { last().connect(); });
    expect(result.current.status.state).toBe('connected');
  });

  it('reports reconnecting on a drop while online, and offline while the device is offline', () => {
    const { result, unmount } = renderHook(() => useRunEventStream('run1'));
    act(() => { last().connect(); last().fail(); });
    expect(result.current.status.state).toBe('reconnecting');
    unmount();

    setOnline(false);
    const { result: r2 } = renderHook(() => useRunEventStream('run2'));
    act(() => { last().fail(); });
    expect(r2.current.status.state).toBe('offline');
  });

  it('reconnects at once on the browser online event', () => {
    const { result } = renderHook(() => useRunEventStream('run1'));
    act(() => { last().connect(); last().fail(); });
    expect(FakeEventSource.open).toHaveLength(1);

    act(() => { window.dispatchEvent(new Event('online')); });
    expect(FakeEventSource.open).toHaveLength(2);
    expect(result.current.status.state).toBe('connecting');
  });

  it('retryNow reopens immediately, carrying the last seq seen', () => {
    const { result } = renderHook(() => useRunEventStream('run1'));
    act(() => { last().connect(); });
    act(() => { last().emit(ev({ id: 'e1', seq: 1 })); });
    act(() => { last().fail(); });
    expect(FakeEventSource.open).toHaveLength(1);

    act(() => { result.current.retryNow(); });
    expect(FakeEventSource.open).toHaveLength(2);
    expect(last().url).toBe('/api/w/ws1/runs/run1/events/stream?after=1');
  });
});
