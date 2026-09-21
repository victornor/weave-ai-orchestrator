import type { SSEStreamingApi } from 'hono/streaming';
import { HEARTBEAT_MS } from '@weave-ai/shared';

export { HEARTBEAT_MS };

/**
 * How long a single SSE write may take before the client is treated as gone. A slow or dead client
 * whose socket never drains would otherwise leave the route loop awaiting a write forever; aborting
 * the response ends the stream so a real client reconnects.
 */
export const WRITE_TIMEOUT_MS = 10_000;

/** A queue that a stream loop can await: resolves on the next push or after `ms`. */
export class Pump<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  push(item: T): void { this.items.push(item); this.wake?.(); this.wake = null; }
  close(): void { this.closed = true; this.wake?.(); this.wake = null; }
  drain(): T[] { const out = this.items; this.items = []; return out; }
  /** Resolves as soon as something is queued, or after `ms` (heartbeat), or on close. */
  wait(ms: number): Promise<void> {
    if (this.items.length || this.closed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { this.wake = null; resolve(); }, ms);
      this.wake = () => { clearTimeout(timer); resolve(); };
    });
  }
  get done(): boolean { return this.closed; }
}

/**
 * Run one SSE write bounded by `timeoutMs` (VS-641). Resolves `true` when the write completed and
 * `false` when it failed or stalled; on a stall the response is aborted so the stream loop can end
 * and the client reconnects. Every write in the SSE routes goes through here.
 */
export async function writeSse(
  stream: SSEStreamingApi,
  write: () => Promise<void>,
  timeoutMs: number = WRITE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const wrote = await Promise.race([write().then(() => true, () => false), timeout]);
    if (!wrote) {
      try { stream.abort(); } catch { /* the response is already gone */ }
    }
    return wrote;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The keepalive a client watchdog watches for. A named event with no `id`, so it never moves a
 * client's replay cursor and is ignored by a client that did not register a `heartbeat` listener.
 */
export async function heartbeat(stream: SSEStreamingApi): Promise<boolean> {
  return writeSse(stream, () => stream.writeSSE({ event: 'heartbeat', data: JSON.stringify({ at: new Date().toISOString() }) }));
}
