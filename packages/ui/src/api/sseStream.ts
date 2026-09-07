/**
 * The reconnect/backoff/online-offline state machine shared by every per-entity SSE stream in the
 * app: the workspace event stream (`EventStream`, `events.ts`), the run event stream
 * (`runStream.ts`) and the job stream (`jobStream.ts`). See `live-streams/connection-state`.
 *
 * `useLiveStream` is frame-shape-agnostic: it owns the `EventSource` lifecycle, the named-event
 * dispatch, the backoff schedule and the `online`/`offline` handling, and hands each raw message
 * to the caller's `onFrame`. Parsing the frame, tracking the resume sequence and folding it into
 * whatever state the caller keeps are the caller's job — `buildUrl` is called fresh before every
 * connection attempt so it can carry the latest `?after=<seq>` the caller has reached.
 */
import { useEffect, useRef, useState } from 'react';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'unreachable';

export interface ConnectionStatus {
  state: ConnectionState;
  /** ISO time of the last event or successful open — the "showing the state from 09:38" stamp. */
  capturedAt: string | null;
  attempts: number;
  /** Only meaningful for a stream that tracks its own resume position (the workspace stream). */
  lastSeq?: number;
}

export const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000];

export interface LiveStreamOptions {
  /** Called fresh before every connection attempt. `null` keeps the stream closed (e.g. no id yet). */
  buildUrl: () => string | null;
  /** Named SSE events the daemon sends; `onmessage` alone only sees unnamed frames. */
  eventTypes: readonly string[];
  onFrame: (m: MessageEvent<string>) => void;
  /** Reopens fresh (attempts and status reset) when this changes; `null` closes the stream. */
  resetKey: string | null;
}

export interface LiveStream {
  status: ConnectionStatus;
  /** Reconnects immediately, resetting the backoff, whatever the current delay or state. */
  retryNow: () => void;
}

const INITIAL_STATUS: ConnectionStatus = { state: 'connecting', capturedAt: null, attempts: 0 };

export function useLiveStream(opts: LiveStreamOptions): LiveStream {
  const { eventTypes, resetKey } = opts;
  // Read through refs so a caller need not memoize buildUrl/onFrame across renders.
  const buildUrlRef = useRef(opts.buildUrl);
  buildUrlRef.current = opts.buildUrl;
  const onFrameRef = useRef(opts.onFrame);
  onFrameRef.current = opts.onFrame;

  const [status, setStatus] = useState<ConnectionStatus>(INITIAL_STATUS);
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    setStatus(INITIAL_STATUS);
    if (resetKey === null) return;

    let stopped = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let currentState: ConnectionState = 'connecting';

    const set = (patch: Partial<ConnectionStatus>): void => {
      if (patch.state) currentState = patch.state;
      setStatus((s) => ({ ...s, ...patch }));
    };

    const open = (): void => {
      if (stopped) return;
      es?.close();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const url = buildUrlRef.current();
      if (!url) return;
      set({ state: 'connecting' });
      const source = new EventSource(url, { withCredentials: true });
      es = source;
      source.onopen = () => {
        attempts = 0;
        set({ state: 'connected', attempts: 0, capturedAt: new Date().toISOString() });
      };
      source.onmessage = (m) => onFrameRef.current(m as MessageEvent<string>);
      for (const type of eventTypes) source.addEventListener(type, (m) => onFrameRef.current(m as MessageEvent<string>));
      source.onerror = () => {
        source.close();
        if (stopped) return;
        attempts += 1;
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        set({ state: offline ? 'offline' : 'reconnecting', attempts });
        const delay = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] ?? 15000;
        timer = setTimeout(open, delay);
      };
    };

    const retryNow = (): void => {
      attempts = 0;
      open();
    };
    retryRef.current = retryNow;

    const onOnline = (): void => {
      if (currentState !== 'connected') retryNow();
    };
    const onOffline = (): void => {
      set({ state: 'offline' });
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }

    open();

    return () => {
      stopped = true;
      es?.close();
      if (timer) clearTimeout(timer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
    };
    // `eventTypes` is expected to be a stable reference (a module-level constant); it is read from
    // the closure above rather than listed here, so a caller passing an inline array literal does
    // not reopen the stream every render.
  }, [resetKey]);

  return { status, retryNow: () => retryRef.current() };
}
