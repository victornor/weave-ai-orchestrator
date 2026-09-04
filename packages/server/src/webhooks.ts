/**
 * Per-workspace webhook dispatcher (PLAN §17). Tails the durable events outbox and POSTs every
 * matching event as JSON to the URLs declared under `webhooks:` in workspace.yaml.
 *
 * Guarantees: at-least-once (the cursor in `webhook_cursors` only advances past an event once its
 * POST succeeded), one in-flight request per webhook, exponential backoff on failure, and a
 * network failure never loses the cursor — the delivery is simply retried on the next pump.
 */
import { createHmac } from 'node:crypto';
import { nowIso } from '@agent-conductor/db';
import { getLogger, type WorkspaceContext } from '@agent-conductor/core';
import type { WorkspaceEvent } from '@agent-conductor/shared';

const log = getLogger('daemon', { component: 'webhooks' });

const ENV_REF = /^\$\{([A-Z0-9_]+)\}$/;
const DEFAULT_POLL_MS = 15_000;
const DEFAULT_BATCH = 100;
const DEFAULT_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 300_000;

export interface WebhookDispatcherOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  pollMs?: number;
  batchSize?: number;
  backoffBaseMs?: number;
  maxBackoffMs?: number;
  timeoutMs?: number;
}

interface HookState {
  url: string;
  events: string[];
  secret: string | null;
  lastSeq: number;
  lastError: string | null;
  attempts: number;
  nextAttemptAt: number;
  inFlight: boolean;
}

/** `*` matches everything; `ticket.*` matches a prefix; anything else is an exact type match. */
export function eventMatches(patterns: string[], type: string): boolean {
  for (const p of patterns) {
    if (p === '*') return true;
    if (p.endsWith('.*') && type.startsWith(p.slice(0, -1))) return true;
    if (p === type) return true;
  }
  return false;
}

export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export class WebhookDispatcher {
  private hooks: HookState[] = [];
  private unsubscribe: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private readonly fetchImpl: typeof fetch;
  private readonly pollMs: number;
  private readonly batchSize: number;
  private readonly backoffBaseMs: number;
  private readonly maxBackoffMs: number;
  private readonly timeoutMs: number;

  constructor(private ctx: WorkspaceContext, opts: WebhookDispatcherOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH;
    this.backoffBaseMs = opts.backoffBaseMs ?? DEFAULT_BACKOFF_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** How many webhooks this dispatcher is tailing (0 = nothing declared, start() is a no-op). */
  size(): number { return this.hooks.length; }

  start(): void {
    if (!this.stopped) return;
    this.hooks = this.ctx.config.webhooks.map((w) => this.load(w));
    if (!this.hooks.length) return;
    this.stopped = false;
    this.unsubscribe = this.ctx.events.on(() => { void this.pump(); });
    this.timer = setInterval(() => { void this.pump(); }, this.pollMs);
    this.timer.unref?.();
    log.info({ workspace: this.ctx.workspaceId, webhooks: this.hooks.length }, 'webhook dispatcher started');
    void this.pump();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    // Let the in-flight request settle so its cursor write lands before the db closes.
    const deadline = Date.now() + 5_000;
    while (this.hooks.some((h) => h.inFlight) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    this.hooks = [];
  }

  /** Deliver everything currently pending on every webhook. Exposed for tests and shutdown drains. */
  async pump(): Promise<void> {
    await Promise.all(this.hooks.map((h) => this.drain(h)));
  }

  // ---------- internals ----------

  private load(w: { url: string; events: string[]; secret?: string }): HookState {
    const row = this.ctx.db.get<{ lastSeq: number; lastError: string | null }>(
      'SELECT last_seq, last_error FROM webhook_cursors WHERE webhook_url = ?', [w.url],
    );
    let lastSeq = row?.lastSeq ?? 0;
    if (!row) {
      // A newly declared webhook starts at "now": history is not replayed into a fresh endpoint.
      lastSeq = this.ctx.events.lastSeq();
      this.ctx.db.run('INSERT INTO webhook_cursors (webhook_url, last_seq, last_error, updated_at) VALUES (?,?,?,?)', [w.url, lastSeq, null, nowIso()]);
    }
    return {
      url: w.url, events: w.events.length ? w.events : ['*'], secret: resolveSecret(w.secret),
      lastSeq, lastError: row?.lastError ?? null, attempts: 0, nextAttemptAt: 0, inFlight: false,
    };
  }

  private async drain(h: HookState): Promise<void> {
    if (h.inFlight || this.stopped || Date.now() < h.nextAttemptAt) return;
    h.inFlight = true;
    try {
      for (;;) {
        if (this.stopped) break;
        const batch = this.ctx.events.since(h.lastSeq, this.batchSize);
        if (!batch.length) break;
        let advanced = h.lastSeq;
        let failed = false;
        for (const ev of batch) {
          if (eventMatches(h.events, ev.type)) {
            const ok = await this.post(h, ev);
            if (!ok) { failed = true; break; }
          }
          advanced = ev.seq;
        }
        if (advanced > h.lastSeq) this.setCursor(h, advanced);
        if (failed) { this.backoff(h); break; }
        if (batch.length < this.batchSize) break;
      }
    } finally {
      h.inFlight = false;
    }
  }

  private async post(h: HookState, ev: WorkspaceEvent): Promise<boolean> {
    const body = JSON.stringify(ev);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'X-AgentConductor-Event': ev.type,
      'X-AgentConductor-Delivery': String(ev.seq),
      'X-AgentConductor-Workspace': this.ctx.config.id,
    };
    if (h.secret) headers['X-AgentConductor-Signature'] = signBody(h.secret, body);
    try {
      const res = await this.fetchImpl(h.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      try { await res.arrayBuffer(); } catch { /* body already consumed or empty */ }
      if (res.ok) { h.attempts = 0; h.lastError = null; return true; }
      h.lastError = `HTTP ${res.status}`;
    } catch (e) {
      h.lastError = (e as Error).message.slice(0, 300);
    }
    log.warn({ url: h.url, seq: ev.seq, type: ev.type, error: h.lastError, attempts: h.attempts + 1 }, 'webhook delivery failed; will retry');
    return false;
  }

  private backoff(h: HookState): void {
    h.attempts += 1;
    h.nextAttemptAt = Date.now() + Math.min(this.maxBackoffMs, this.backoffBaseMs * 2 ** (h.attempts - 1));
    this.ctx.db.run('UPDATE webhook_cursors SET last_error = ?, updated_at = ? WHERE webhook_url = ?', [h.lastError, nowIso(), h.url]);
  }

  private setCursor(h: HookState, seq: number): void {
    h.lastSeq = seq;
    this.ctx.db.run('UPDATE webhook_cursors SET last_seq = ?, last_error = ?, updated_at = ? WHERE webhook_url = ?', [seq, h.lastError, nowIso(), h.url]);
  }
}

/** workspace.yaml secrets are `${ENV_VAR}` refs; the loader resolves them, so a surviving ref means the variable is unset. */
function resolveSecret(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = ENV_REF.exec(raw);
  if (!m) return raw;
  const value = process.env[m[1]!];
  if (value) return value;
  log.warn({ envVar: m[1] }, 'webhook secret environment variable is not set; deliveries will be unsigned');
  return null;
}
