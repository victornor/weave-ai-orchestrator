/**
 * Live input for a running turn (S7). A human message that arrives while a turn streams is queued
 * here by the child's stdin reader and drained by the loop at the next request boundary, after the
 * current step's tool results. Nothing in it touches the adapter, which only writes the `send` line.
 */
export interface SteeringSource {
  /** Take everything queued so far, in order; the queue is empty afterwards. */
  drain(): string[];
  /** How many messages are queued, without removing them. */
  readonly pending: number;
}

export class SteeringQueue implements SteeringSource {
  private items: string[] = [];
  push(text: string): void { if (text.length > 0) this.items.push(text); }
  drain(): string[] { const out = this.items; this.items = []; return out; }
  get pending(): number { return this.items.length; }
}