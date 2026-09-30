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
 *
 * VS-641: a socket can be half-open — a slept laptop, a switched network, a proxy that dropped an
 * idle stream without a close — so `onerror` never fires and the stream silently stops delivering
 * frames. `SseWatchdog` tracks the age of the last frame or heartbeat; `stale` is shown honestly
 * before the connection is declared dead and reconnected. See `live-streams/heartbeats`.
 */
import { useEffect, useRef, useState } from 'react';
import { HEARTBEAT_MS } from '@weave-ai/shared';

export type ConnectionState = 'connecting' | 'connected' | 'stale' | 'reconnecting' | 'offline' | 'unreachable' | 'hidden';

export interface ConnectionStatus {
  state: ConnectionState;
  /** ISO time of the last event or successful open — the "showing the state from 09:38" stamp. */
  capturedAt: string | null;
  /** Epoch ms of the last frame or heartbeat received on this stream (VS-641). */
  lastFrameAt: number | null;
  attempts: number;
  /** Only meaningful for a stream that tracks its own resume position (the workspace stream). */
  lastSeq?: number;
}

export const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000];

/**
 * VS-765: an attempt that has neither opened nor failed this long is abandoned. `EventSource` only
 * fires `onerror` when the browser gives up, which for a SYN into a dead path or a request queued
 * behind the six-connection HTTP/1.1 cap can be minutes — and the silence watchdog only runs once a
 * stream has opened, so nothing else would ever notice.
 */
export const CONNECT_TIMEOUT_MS = 20_000;

/** Why a stream was reopened (VS-765). `error` and `connect-timeout` are failures; the rest are triggers. */
export type ReopenCause = 'error' | 'connect-timeout' | 'silence' | 'wake' | 'online' | 'retry';

export interface ReconnectEntry {
  at: string;
  stream: string;
  cause: ReopenCause;
  /** `navigator.onLine` when it happened; null where the browser does not say. */
  online: boolean | null;
  attempts: number;
  /** Age of the last frame or heartbeat when the stream was given up on; null if none had arrived. */
  lastFrameAgeMs: number | null;
  /** What `/api/health` answered right after a failure: `ok`, `http <status>`, `timeout` or `network`
   * (a refused or reset connection, a certificate the browser rejects, or no route — fetch cannot say which). */
  probe?: string;
}

const RECONNECT_LOG_MAX = 50;
const reconnectLog: ReconnectEntry[] = [];
const reconnectListeners = new Set<() => void>();

export function getReconnectLog(): readonly ReconnectEntry[] { return reconnectLog; }
export function subscribeReconnectLog(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => { reconnectListeners.delete(fn); };
}
export function resetReconnectLog(): void { reconnectLog.length = 0; }

function notifyReconnectLog(): void { for (const fn of reconnectListeners) fn(); }

/** Appends to the bounded log and returns the entry so a probe can fill in its result later. */
export function recordReopen(stream: string, cause: ReopenCause, attempts: number, lastFrameAt: number | null): ReconnectEntry {
  const entry: ReconnectEntry = {
    at: new Date().toISOString(),
    stream,
    cause,
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    attempts,
    lastFrameAgeMs: lastFrameAt === null ? null : Date.now() - lastFrameAt,
  };
  reconnectLog.push(entry);
  if (reconnectLog.length > RECONNECT_LOG_MAX) reconnectLog.shift();
  notifyReconnectLog();
  return entry;
}

const PROBE_TIMEOUT_MS = 5_000;
let probing = false;

/**
 * One `/api/health` read after a failure, so the log can tell a daemon that answers (the stream alone
 * is broken) from one that does not (network, Tailscale, certificate). At most one runs at a time.
 */
export function probeHealth(entry: ReconnectEntry): void {
  if (probing || typeof fetch !== 'function') return;
  probing = true;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), PROBE_TIMEOUT_MS);
  let aborted = false;
  ctl?.signal.addEventListener('abort', () => { aborted = true; });
  void fetch('/api/health', { signal: ctl?.signal, cache: 'no-store' })
    .then((r) => { entry.probe = r.ok ? 'ok' : `http ${r.status}`; })
    .catch(() => { entry.probe = aborted ? 'timeout' : 'network'; })
    .finally(() => { clearTimeout(timer); probing = false; notifyReconnectLog(); });
}

/** The daemon's keepalive cadence (shared with `packages/shared`) and the windows derived from it. */
export const WATCHDOG_TICK_MS = HEARTBEAT_MS / 3;
/** No frame or heartbeat this long → `stale` (about 2 heartbeats). */
export const STALE_AFTER_MS = HEARTBEAT_MS * 2;
/** No frame or heartbeat this long → the connection is dead (about 2.5 heartbeats). */
export const DEAD_AFTER_MS = HEARTBEAT_MS * 2.5;

interface WatchdogCallbacks {
  /** The last frame is now older than `STALE_AFTER_MS`. Fired once per stale span. */
  onStale: () => void;
  /** A frame arrived after a stale span. */
  onAlive: () => void;
  /** Nothing arrived for `DEAD_AFTER_MS`; the stream must reconnect itself. */
  onDead: () => void;
  /** A tick overran badly — the machine slept — so the socket cannot be trusted. */
  onWake: () => void;
  /** VS-765: an attempt begun with `beginConnect()` neither opened nor failed within `CONNECT_TIMEOUT_MS`. */
  onConnectTimeout: () => void;
}

/**
 * One timer per stream that watches for silence. `touch()` records a frame and is deliberately
 * free of status notifications (VS-417: a busy turn must not re-render every subscriber). The
 * 5-second tick drives the stale/dead transitions and detects a slept machine, whose next tick
 * fires far later than scheduled.
 */
export class SseWatchdog {
  private frameAt = Date.now();
  private tickAt = Date.now();
  private stale = false;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private everOpened = false;

  constructor(private readonly cb: WatchdogCallbacks) {}

  /** A connection attempt has begun: if `start()` or `stop()` does not follow in time, it is abandoned. */
  beginConnect(): void {
    this.clearConnect();
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      this.cb.onConnectTimeout();
    }, CONNECT_TIMEOUT_MS);
  }

  private clearConnect(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  get lastFrameAt(): number { return this.frameAt; }

  /** When this stream last heard from the daemon, or null if no connection has ever opened — `frameAt`
   *  alone starts at construction, which would pass a never-connected stream off as one that went quiet. */
  get lastHeardAt(): number | null { return this.everOpened ? this.frameAt : null; }

  start(): void {
    this.clearConnect();
    this.everOpened = true;
    this.running = true;
    this.frameAt = Date.now();
    this.tickAt = Date.now();
    this.stale = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), WATCHDOG_TICK_MS);
  }

  stop(): void {
    this.clearConnect();
    this.running = false;
    this.stale = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  touch(): void {
    if (!this.running) return;
    this.frameAt = Date.now();
    if (this.stale) {
      this.stale = false;
      this.cb.onAlive();
    }
  }

  private tick(): void {
    const now = Date.now();
    if (now - this.tickAt > WATCHDOG_TICK_MS * 2) {
      this.tickAt = now;
      this.frameAt = now;
      this.stale = false;
      this.cb.onWake();
      return;
    }
    this.tickAt = now;
    const age = now - this.frameAt;
    if (age >= DEAD_AFTER_MS) {
      this.stop();
      this.cb.onDead();
      return;
    }
    if (!this.stale && age >= STALE_AFTER_MS) {
      this.stale = true;
      this.cb.onStale();
    }
  }
}

export interface LiveStreamOptions {
  /** Called fresh before every connection attempt. `null` keeps the stream closed (e.g. no id yet). */
  buildUrl: () => string | null;
  /** Named SSE events the daemon sends; `onmessage` alone only sees unnamed frames. */
  eventTypes: readonly string[];
  onFrame: (m: MessageEvent<string>) => void;
  /** Reopens fresh (attempts and status reset) when this changes; `null` closes the stream. */
  resetKey: string | null;
  /** VS-641: called after a reconnect, so the caller can refetch the reads this stream keeps fresh. */
  onResync?: () => void;
}

export interface LiveStream {
  status: ConnectionStatus;
  /** Reconnects immediately, resetting the backoff, whatever the current delay or state. */
  retryNow: () => void;
}

const INITIAL_STATUS: ConnectionStatus = { state: 'connecting', capturedAt: null, lastFrameAt: null, attempts: 0 };

/** True when this document is in a background tab (VS-227): persistent streams must not hold HTTP/1.1 slots. */
export function documentIsHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useLiveStream(opts: LiveStreamOptions): LiveStream {
  const { eventTypes, resetKey } = opts;
  // Read through refs so a caller need not memoize buildUrl/onFrame/onResync across renders.
  const buildUrlRef = useRef(opts.buildUrl);
  buildUrlRef.current = opts.buildUrl;
  const onFrameRef = useRef(opts.onFrame);
  onFrameRef.current = opts.onFrame;
  const onResyncRef = useRef(opts.onResync);
  onResyncRef.current = opts.onResync;

  const [status, setStatus] = useState<ConnectionStatus>(INITIAL_STATUS);
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    setStatus(INITIAL_STATUS);
    if (resetKey === null) return;

    let stopped = false;
    let hidden = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let everConnected = false;

    const set = (patch: Partial<ConnectionStatus>): void => {
      setStatus((s) => ({ ...s, ...patch }));
    };

    const label = buildUrlRef.current()?.split('?')[0] ?? 'stream';

    // A failed attempt — the browser's `onerror` or an attempt that never opened — backs off and retries.
    const failed = (cause: 'error' | 'connect-timeout'): void => {
      watchdog.stop();
      es?.close();
      if (stopped || hidden) return;
      attempts += 1;
      const entry = recordReopen(label, cause, attempts, watchdog.lastHeardAt);
      if (attempts === 1) probeHealth(entry);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      set({ state: offline ? 'offline' : 'reconnecting', attempts });
      const delay = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] ?? 15000;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => open(), delay);
    };

    const watchdog: SseWatchdog = new SseWatchdog({
      onStale: () => set({ state: 'stale', lastFrameAt: watchdog.lastFrameAt }),
      onAlive: () => set({ state: 'connected', lastFrameAt: Date.now() }),
      onDead: () => {
        es?.close();
        if (stopped || hidden) return;
        recordReopen(label, 'silence', attempts, watchdog.lastHeardAt);
        set({ state: 'reconnecting', lastFrameAt: watchdog.lastFrameAt });
        open('reconnecting');
      },
      onWake: () => {
        if (stopped || hidden) return;
        recordReopen(label, 'wake', attempts, watchdog.lastHeardAt);
        open('reconnecting');
      },
      onConnectTimeout: () => failed('connect-timeout'),
    });

    const open = (state: ConnectionState = 'connecting'): void => {
      if (stopped || hidden) return;
      es?.close();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const url = buildUrlRef.current();
      if (!url) return;
      set({ state });
      const source = new EventSource(url, { withCredentials: true });
      es = source;
      watchdog.beginConnect();
      source.onopen = () => {
        attempts = 0;
        set({ state: 'connected', attempts: 0, capturedAt: new Date().toISOString(), lastFrameAt: Date.now() });
        watchdog.start();
        if (everConnected) onResyncRef.current?.();
        everConnected = true;
      };
      source.onmessage = (m) => { watchdog.touch(); onFrameRef.current(m as MessageEvent<string>); };
      for (const type of eventTypes) source.addEventListener(type, (m) => { watchdog.touch(); onFrameRef.current(m as MessageEvent<string>); });
      // The keepalive is a named event `EventSource` delivers, unlike an SSE comment; only the clock
      // is touched here, never a status notification (VS-417, VS-641).
      source.addEventListener('heartbeat', () => watchdog.touch());
      source.onerror = () => failed('error');
    };

    const retryNow = (): void => {
      attempts = 0;
      recordReopen(label, 'retry', 0, watchdog.lastHeardAt);
      open();
    };
    retryRef.current = retryNow;

    const onOnline = (): void => {
      if (stopped || hidden) return;
      // Trust nothing about the old socket: a device regaining its network is exactly when a
      // half-open stream is most likely, so open fresh and let onopen re-sync (VS-641).
      attempts = 0;
      recordReopen(label, 'online', 0, watchdog.lastHeardAt);
      open('reconnecting');
    };
    const onOffline = (): void => {
      watchdog.stop();
      set({ state: 'offline' });
    };

    const onVisibility = (): void => {
      if (documentIsHidden()) {
        hidden = true;
        watchdog.stop();
        es?.close();
        es = null;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        set({ state: 'hidden' });
        return;
      }
      if (!hidden) return;
      hidden = false;
      open();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      document.addEventListener('visibilitychange', onVisibility);
    }

    if (documentIsHidden()) {
      hidden = true;
      set({ state: 'hidden' });
    } else {
      open();
    }

    return () => {
      stopped = true;
      watchdog.stop();
      es?.close();
      if (timer) clearTimeout(timer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
    // `eventTypes` is expected to be a stable reference (a module-level constant); it is read from
    // the closure above rather than listed here, so a caller passing an inline array literal does
    // not reopen the stream every render.
  }, [resetKey]);

  return { status, retryNow: () => retryRef.current() };
}
