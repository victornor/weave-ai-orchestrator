/**
 * VS-140: whatever caused a workspace SSE drop — including one the client never saw as an error —
 * reconnecting reconciles the decisions list against the server rather than trusting whatever was
 * on screen when the connection dropped.
 */
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventStream } from '../api/events';
import { qk } from '../api/keys';

/** A controllable EventSource: enough of the surface `EventStream` uses. */
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
  close(): void {
    this.closed = true;
  }
  connect(): void {
    this.onopen?.();
  }
  fail(): void {
    this.onerror?.();
  }
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
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const last = (): FakeEventSource => FakeEventSource.open[FakeEventSource.open.length - 1]!;

describe('EventStream reconnect reconciliation', () => {
  it('does not force a decisions refetch on the first connection of a session', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockReturnValue(Promise.resolve());
    const stream = new EventStream('ws1', qc);
    stream.start();
    last().connect();

    expect(spy).not.toHaveBeenCalledWith({ queryKey: qk.decisions('ws1') });
    stream.stop();
  });

  it('forces a decisions refetch on every reconnect after the first', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockReturnValue(Promise.resolve());
    const stream = new EventStream('ws1', qc);
    stream.start();
    last().connect();
    spy.mockClear();

    last().fail();
    vi.advanceTimersByTime(1000);
    last().connect();

    expect(spy).toHaveBeenCalledWith({ queryKey: qk.decisions('ws1') });
    stream.stop();
  });

  it('reconciles even when the drop never surfaced as an error, on the next successful open', () => {
    // A stall the browser never reports as `onerror` never schedules its own retry, but anything
    // else that reopens the stream (a manual retry, `online` firing again) still reconciles.
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockReturnValue(Promise.resolve());
    const stream = new EventStream('ws1', qc);
    stream.start();
    last().connect();
    spy.mockClear();

    // Simulate the stream being reopened out from under a silent stall.
    stream.stop();
    stream.start();
    last().connect();

    expect(spy).toHaveBeenCalledWith({ queryKey: qk.decisions('ws1') });
    stream.stop();
  });
});
