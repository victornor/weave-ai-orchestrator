/** A counting semaphore whose waiters can be abandoned: a run cancelled while it waits for a provider slot never takes one. */
export class Semaphore {
  private held = 0;
  private waiters: Array<{ grant: () => void }> = [];
  constructor(private limit: number) {}

  setLimit(limit: number): void { this.limit = limit; this.pump(); }
  get active(): number { return this.held; }
  get waiting(): number { return this.waiters.length; }

  /** Resolves with a release function once a slot is free, or rejects when `signal` aborts first. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'));
      const waiter = { grant: () => { signal?.removeEventListener('abort', onAbort); this.held++; let done = false; resolve(() => { if (done) return; done = true; this.held--; this.pump(); }); } };
      const onAbort = (): void => { const i = this.waiters.indexOf(waiter); if (i >= 0) this.waiters.splice(i, 1); reject(new Error('aborted')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
      this.pump();
    });
  }

  private pump(): void { while (this.held < this.limit && this.waiters.length > 0) this.waiters.shift()!.grant(); }
}
