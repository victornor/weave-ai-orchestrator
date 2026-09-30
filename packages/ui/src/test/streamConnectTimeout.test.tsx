/**
 * VS-765: a connection attempt that neither opens nor errors — a SYN into a dead path after a
 * Tailscale or network change, or a request queued behind the six-connection HTTP/1.1 cap — used to
 * leave a stream `connecting`/`reconnecting` for as long as the browser waited, because the silence
 * watchdog only runs once a stream has opened. Also: a pending backoff timer must not reopen a stream
 * that something else already reopened, and each reopen is recorded with its cause.
 */
import { act, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventStream, GlobalEventStream } from '../api/events';
import { qk } from '../api/keys';
import {
  BACKOFF, CONNECT_TIMEOUT_MS, DEAD_AFTER_MS, STALE_AFTER_MS, WATCHDOG_TICK_MS, getReconnectLog, resetReconnectLog, useLiveStream,
} from '../api/sseStream';

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
  connect(): void { this.onopen?.(); }
  fail(): void { this.onerror?.(); }
  emit(type: string, data: unknown, lastEventId = ''): void {
    const m = { data: JSON.stringify(data), lastEventId } as MessageEvent<string>;
    for (const fn of this.listeners.get(type) ?? []) fn(m);
  }
}
const last = (): FakeEventSource => FakeEventSource.open[FakeEventSource.open.length - 1]!;

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.open = [];
  setOnline(true);
  resetReconnectLog();
  vi.stubGlobal('EventSource', FakeEventSource);
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const causes = (): string[] => getReconnectLog().map((e) => e.cause);

describe('a stream that never opens', () => {
  it('useLiveStream abandons the attempt and retries with backoff', () => {
    const { result } = renderHook(() => useLiveStream({ resetKey: 'a', eventTypes: [], buildUrl: () => '/api/x?after=3', onFrame: () => {} }));
    expect(FakeEventSource.open).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1); });
    expect(FakeEventSource.open).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(FakeEventSource.open[0]!.closed).toBe(true);
    expect(result.current.status.state).toBe('reconnecting');
    act(() => { vi.advanceTimersByTime(BACKOFF[0]!); });
    expect(FakeEventSource.open).toHaveLength(2);
    expect(causes()).toEqual(['connect-timeout']);
  });

  it('EventStream abandons the attempt, retries, and resumes from its last seq', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    last().connect();
    last().emit('ticket.updated', { seq: 7, type: 'ticket.updated', workspaceId: 'ws1', createdAt: new Date().toISOString() });
    // The connection drops and the retry never opens.
    last().fail();
    vi.advanceTimersByTime(BACKOFF[0]!);
    expect(FakeEventSource.open).toHaveLength(2);
    expect(last().url).toContain('after=7');
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(FakeEventSource.open[1]!.closed).toBe(true);
    expect(stream.getStatus().state).toBe('reconnecting');
    vi.advanceTimersByTime(BACKOFF[1]!);
    expect(FakeEventSource.open).toHaveLength(3);
    expect(last().url).toContain('after=7');
    expect(causes()).toEqual(['error', 'connect-timeout']);
    stream.stop();
  });

  it('EventStream keeps trying through repeated hung attempts without a reload', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    for (let i = 0; i < 4; i += 1) vi.advanceTimersByTime(CONNECT_TIMEOUT_MS + BACKOFF[Math.min(i, BACKOFF.length - 1)]!);
    expect(FakeEventSource.open.length).toBeGreaterThanOrEqual(4);
    last().connect();
    expect(stream.getStatus().state).toBe('connected');
    stream.stop();
  });

  it('GlobalEventStream abandons the attempt and retries', () => {
    const stream = new GlobalEventStream(new QueryClient());
    stream.start();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(FakeEventSource.open[0]!.closed).toBe(true);
    vi.advanceTimersByTime(BACKOFF[0]!);
    expect(FakeEventSource.open).toHaveLength(2);
    expect(stream.getStatus().state).toBe('reconnecting');
    stream.stop();
  });

  it('a silent drop whose replacement also hangs is still caught', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    last().connect();
    vi.advanceTimersByTime(DEAD_AFTER_MS + WATCHDOG_TICK_MS);
    expect(FakeEventSource.open).toHaveLength(2); // silence reopened it
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(FakeEventSource.open[1]!.closed).toBe(true);
    vi.advanceTimersByTime(BACKOFF[0]!);
    expect(FakeEventSource.open).toHaveLength(3);
    expect(causes()).toEqual(['silence', 'connect-timeout']);
    stream.stop();
  });
});

describe('a pending backoff timer', () => {
  it('EventStream: coming back online cancels it, so exactly one connection results', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    last().connect();
    last().fail(); // backoff timer pending
    window.dispatchEvent(new Event('online'));
    expect(FakeEventSource.open).toHaveLength(2);
    last().connect();
    vi.advanceTimersByTime(BACKOFF[0]! + 10);
    expect(FakeEventSource.open).toHaveLength(2);
    expect(last().closed).toBe(false);
    expect(stream.getStatus().state).toBe('connected');
    stream.stop();
  });

  it('EventStream: a manual retry cancels it too', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    last().fail();
    stream.retryNow();
    last().connect();
    vi.advanceTimersByTime(BACKOFF[0]! + 10);
    expect(FakeEventSource.open).toHaveLength(2);
    expect(last().closed).toBe(false);
    stream.stop();
  });
});

describe('recovery re-syncs what was missed', () => {
  it('EventStream: after a drop and a reconnect, every stream-backed read is refetched', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockReturnValue(Promise.resolve());
    const stream = new EventStream('ws1', qc);
    stream.start();
    last().connect();
    spy.mockClear();
    last().fail();
    vi.advanceTimersByTime(BACKOFF[0]!);
    last().connect();
    for (const key of [qk.workers('ws1'), qk.tickets('ws1'), qk.decisions('ws1')]) expect(spy).toHaveBeenCalledWith({ queryKey: key });
    stream.stop();
  });

  it('useLiveStream: onResync runs after a reconnect that follows a hung attempt', () => {
    const onResync = vi.fn();
    renderHook(() => useLiveStream({ resetKey: 'a', eventTypes: [], buildUrl: () => '/api/x', onFrame: () => {}, onResync }));
    act(() => { last().connect(); });
    expect(onResync).not.toHaveBeenCalled();
    act(() => { last().fail(); vi.advanceTimersByTime(BACKOFF[0]!); });
    act(() => { vi.advanceTimersByTime(CONNECT_TIMEOUT_MS); vi.advanceTimersByTime(BACKOFF[1]!); });
    act(() => { last().connect(); });
    expect(onResync).toHaveBeenCalledTimes(1);
  });
});

describe('heartbeats keep an idle stream alive', () => {
  it('EventStream stays connected well past the dead threshold while heartbeats arrive', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    last().connect();
    const source = last();
    for (let t = 0; t < DEAD_AFTER_MS * 4; t += 15_000) {
      vi.advanceTimersByTime(15_000);
      source.emit('heartbeat', { at: new Date().toISOString() });
    }
    expect(FakeEventSource.open).toHaveLength(1);
    expect(source.closed).toBe(false);
    expect(stream.getStatus().state).toBe('connected');
    stream.stop();
  });

  it('without heartbeats the same idle stream goes stale and is reopened', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    last().connect();
    vi.advanceTimersByTime(STALE_AFTER_MS);
    expect(stream.getStatus().state).toBe('stale');
    vi.advanceTimersByTime(DEAD_AFTER_MS);
    expect(FakeEventSource.open.length).toBeGreaterThan(1);
    stream.stop();
  });
});

describe('the reconnect log', () => {
  it('attributes a silent drop to silence, with the age of the last frame', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    last().connect();
    vi.advanceTimersByTime(DEAD_AFTER_MS + WATCHDOG_TICK_MS);
    const entry = getReconnectLog()[0]!;
    expect(entry).toMatchObject({ stream: 'workspace:ws1', cause: 'silence', online: true });
    expect(entry.lastFrameAgeMs).toBeGreaterThanOrEqual(DEAD_AFTER_MS);
    stream.stop();
  });

  it('reports no last-frame age for a stream that never connected, rather than its age since mount', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(getReconnectLog().map((e) => [e.cause, e.lastFrameAgeMs])).toEqual([['connect-timeout', null]]);
    stream.stop();
  });

  it('records a wake, an online event and a manual retry', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    last().connect();
    vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
    vi.advanceTimersByTime(WATCHDOG_TICK_MS);
    window.dispatchEvent(new Event('online'));
    stream.retryNow();
    expect(causes()).toEqual(['wake', 'online', 'retry']);
    stream.stop();
  });

  it('follows a failure with one /api/health probe and records what it answered', async () => {
    vi.useRealTimers();
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    last().connect();
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 401 }));
    last().fail();
    await vi.waitFor(() => expect(getReconnectLog()[0]!.probe).toBe('http 401'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/health');
    stream.stop();
  });

  it('records a network/certificate failure of the probe as `network`', async () => {
    vi.useRealTimers();
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    last().fail();
    await vi.waitFor(() => expect(getReconnectLog()[0]!.probe).toBe('network'));
    stream.stop();
  });

  it('keeps only the last 50 entries', () => {
    const stream = new EventStream('ws1', new QueryClient());
    stream.start();
    for (let i = 0; i < 60; i += 1) stream.retryNow();
    expect(getReconnectLog()).toHaveLength(50);
    stream.stop();
  });
});
