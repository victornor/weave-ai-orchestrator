import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_MS } from '@weave-ai/shared';
import { DEAD_AFTER_MS, STALE_AFTER_MS, WATCHDOG_TICK_MS, useLiveStream } from '../api/sseStream';
import { resetDocumentVisible, setDocumentHidden } from './visibility';

/** A controllable EventSource, driving `onopen`/`onerror` as well as named frames. */
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
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: unknown): void {
    const m = { data: JSON.stringify(data) } as MessageEvent<string>;
    for (const fn of this.listeners.get(type) ?? []) fn(m);
  }
  connect(): void {
    this.onopen?.();
  }
  fail(): void {
    this.onerror?.();
  }
}

const last = (): FakeEventSource => FakeEventSource.open[FakeEventSource.open.length - 1]!;

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
  resetDocumentVisible();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useLiveStream', () => {
  it('opens nothing when the reset key is null', () => {
    const { result } = renderHook(() => useLiveStream({ resetKey: null, eventTypes: [], buildUrl: () => '/x', onFrame: () => {} }));
    expect(FakeEventSource.open).toHaveLength(0);
    expect(result.current.status.state).toBe('connecting');
  });

  it('reports connecting then connected, and delivers named frames to onFrame', () => {
    const onFrame = vi.fn();
    const { result } = renderHook(() =>
      useLiveStream({ resetKey: 'a', eventTypes: ['x.frame'], buildUrl: () => '/api/x', onFrame }),
    );
    expect(result.current.status.state).toBe('connecting');
    act(() => {
      last().connect();
    });
    expect(result.current.status.state).toBe('connected');

    act(() => {
      last().emit('x.frame', { seq: 1 });
    });
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it('drops to reconnecting on error while the device is online, and retries with backoff', () => {
    const { result } = renderHook(() => useLiveStream({ resetKey: 'a', eventTypes: [], buildUrl: () => '/api/x', onFrame: () => {} }));
    act(() => {
      last().connect();
    });

    const dropped = last();
    act(() => {
      dropped.fail();
    });
    expect(dropped.closed).toBe(true);
    expect(result.current.status.state).toBe('reconnecting');
    expect(FakeEventSource.open).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(FakeEventSource.open).toHaveLength(2);
  });

  it('reports offline when the device is offline, distinct from reconnecting', () => {
    setOnline(false);
    const { result } = renderHook(() => useLiveStream({ resetKey: 'a', eventTypes: [], buildUrl: () => '/api/x', onFrame: () => {} }));
    act(() => {
      last().fail();
    });
    expect(result.current.status.state).toBe('offline');
  });

  it('the browser offline event moves a connected stream to offline', () => {
    const { result } = renderHook(() => useLiveStream({ resetKey: 'a', eventTypes: [], buildUrl: () => '/api/x', onFrame: () => {} }));
    act(() => {
      last().connect();
    });
    expect(result.current.status.state).toBe('connected');

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.status.state).toBe('offline');
  });

  it('reconnects immediately on the online event rather than waiting out the backoff', () => {
    const { result } = renderHook(() => useLiveStream({ resetKey: 'a', eventTypes: [], buildUrl: () => '/api/x', onFrame: () => {} }));
    act(() => {
      last().connect();
      last().fail();
    });
    expect(result.current.status.state).toBe('reconnecting');
    expect(FakeEventSource.open).toHaveLength(1);

    // No time advanced: without the fast path this would still be waiting out the 500ms backoff.
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(FakeEventSource.open).toHaveLength(2);
  });

  it('retryNow reopens immediately and resets the backoff counter', () => {
    const { result } = renderHook(() => useLiveStream({ resetKey: 'a', eventTypes: [], buildUrl: () => '/api/x', onFrame: () => {} }));
    act(() => {
      last().connect();
      last().fail();
    });
    expect(FakeEventSource.open).toHaveLength(1);

    act(() => {
      result.current.retryNow();
    });
    expect(FakeEventSource.open).toHaveLength(2);
    expect(result.current.status.state).toBe('connecting');

    // A failure right after the manual retry starts the backoff ladder over, at the first rung.
    act(() => {
      last().fail();
    });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(FakeEventSource.open).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeEventSource.open).toHaveLength(3);
  });

  it('closes the stream and stops retrying when the reset key clears', () => {
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useLiveStream({ resetKey: id, eventTypes: [], buildUrl: () => (id ? '/api/x' : null), onFrame: () => {} }), {
      initialProps: { id: 'a' as string | null },
    });
    act(() => {
      last().connect();
    });
    const opened = last();

    rerender({ id: null });
    expect(opened.closed).toBe(true);
    expect(result.current.status.state).toBe('connecting');

    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(FakeEventSource.open).toHaveLength(1);
  });
});

describe('useLiveStream watchdog (VS-641)', () => {
  it('goes stale, then reconnects a silent stream with no error, resuming at after=', () => {
    let after = 0;
    const onResync = vi.fn();
    const { result } = renderHook(() =>
      useLiveStream({
        resetKey: 'a',
        eventTypes: ['x.frame'],
        buildUrl: () => `/api/x${after ? `?after=${after}` : ''}`,
        onFrame: () => {},
        onResync,
      }),
    );
    act(() => { last().connect(); });
    expect(result.current.status.state).toBe('connected');

    after = 7;
    act(() => { last().emit('x.frame', { seq: 7 }); });

    act(() => { vi.advanceTimersByTime(STALE_AFTER_MS); });
    expect(result.current.status.state).toBe('stale');

    act(() => { vi.advanceTimersByTime(DEAD_AFTER_MS - STALE_AFTER_MS + WATCHDOG_TICK_MS); });
    expect(result.current.status.state).toBe('reconnecting');
    expect(FakeEventSource.open).toHaveLength(2);
    expect(last().url).toBe('/api/x?after=7');

    act(() => { last().connect(); });
    expect(result.current.status.state).toBe('connected');
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it('never reconnects a stream that keeps receiving heartbeats', () => {
    const { result } = renderHook(() => useLiveStream({ resetKey: 'a', eventTypes: [], buildUrl: () => '/api/x', onFrame: () => {} }));
    act(() => { last().connect(); });
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(HEARTBEAT_MS - 1000);
        last().emit('heartbeat', { at: 'now' });
      });
    }
    expect(FakeEventSource.open).toHaveLength(1);
    expect(result.current.status.state).toBe('connected');
  });

  it('forces a fresh connection on online even while it reports connected, and re-syncs', () => {
    const onResync = vi.fn();
    const { result } = renderHook(() => useLiveStream({ resetKey: 'a', eventTypes: [], buildUrl: () => '/api/x', onFrame: () => {}, onResync }));
    act(() => { last().connect(); });
    expect(result.current.status.state).toBe('connected');

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(FakeEventSource.open).toHaveLength(2);

    act(() => { last().connect(); });
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it('treats a long tick gap as a machine wake and reconnects', () => {
    const { result } = renderHook(() => useLiveStream({ resetKey: 'a', eventTypes: [], buildUrl: () => '/api/x', onFrame: () => {} }));
    act(() => { last().connect(); });

    // The machine slept: the wall clock jumps without the interval having run in between.
    vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
    act(() => { vi.advanceTimersByTime(WATCHDOG_TICK_MS); });
    expect(FakeEventSource.open).toHaveLength(2);
    expect(result.current.status.state).toBe('reconnecting');

    act(() => { last().connect(); });
    expect(result.current.status.state).toBe('connected');
  });
});

describe('useLiveStream visibility (VS-227)', () => {
  it('hides by closing the EventSource without going offline, and resumes from the latest after=', () => {
    let after = 0;
    const { result } = renderHook(() =>
      useLiveStream({
        resetKey: 'a',
        eventTypes: [],
        buildUrl: () => `/api/x${after ? `?after=${after}` : ''}`,
        onFrame: () => {},
      }),
    );
    act(() => {
      last().connect();
    });
    after = 7;
    const first = last();
    act(() => {
      setDocumentHidden(true);
    });
    expect(first.closed).toBe(true);
    expect(result.current.status.state).toBe('hidden');
    expect(result.current.status.attempts).toBe(0);

    act(() => {
      first.fail();
      vi.advanceTimersByTime(20_000);
    });
    expect(FakeEventSource.open.filter((s) => !s.closed)).toHaveLength(0);

    act(() => {
      setDocumentHidden(false);
    });
    expect(last().url).toBe('/api/x?after=7');
    expect(result.current.status.state).toBe('connecting');
  });
});
