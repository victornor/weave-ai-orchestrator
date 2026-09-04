import type { SSEStreamingApi } from 'hono/streaming';

export const HEARTBEAT_MS = 15_000;

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

export async function heartbeat(stream: SSEStreamingApi): Promise<void> {
  await stream.write(': ping\n\n');
}
