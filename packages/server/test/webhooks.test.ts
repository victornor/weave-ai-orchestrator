import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebhookDispatcher, eventMatches, signBody } from '../src/webhooks.js';
import { makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
let dispatcher: WebhookDispatcher | null = null;
afterEach(async () => { await dispatcher?.stop(); dispatcher = null; await harness?.close(); harness = null; });

interface Delivery { url: string; headers: Record<string, string>; body: string }

/** Records every POST; `fail` makes the next N calls throw (network failure) or return a 500. */
function recorder(options: { failTimes?: number; mode?: 'throw' | 'status' } = {}): { fetchImpl: typeof fetch; deliveries: Delivery[]; remainingFailures: () => number } {
  let failures = options.failTimes ?? 0;
  const deliveries: Delivery[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (failures > 0) {
      failures -= 1;
      if ((options.mode ?? 'throw') === 'throw') throw new Error('ECONNREFUSED');
      return new Response('nope', { status: 500 });
    }
    deliveries.push({
      url: String(input),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: String(init?.body ?? ''),
    });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, deliveries, remainingFailures: () => failures };
}

function boot(webhooks: Array<{ url: string; events: string[]; secret?: string }>, fetchImpl: typeof fetch): { h: Harness; d: WebhookDispatcher } {
  harness = makeHarness();
  harness.runtime.ctx.config.webhooks = webhooks;
  dispatcher = new WebhookDispatcher(harness.runtime.ctx, { fetchImpl, pollMs: 60_000, backoffBaseMs: 0, maxBackoffMs: 0 });
  return { h: harness, d: dispatcher };
}

describe('eventMatches', () => {
  it('handles exact names, prefix wildcards and *', () => {
    expect(eventMatches(['*'], 'ticket.status')).toBe(true);
    expect(eventMatches(['ticket.*'], 'ticket.status')).toBe(true);
    expect(eventMatches(['ticket.*'], 'run.started')).toBe(false);
    expect(eventMatches(['run.started', 'run.finished'], 'run.finished')).toBe(true);
    expect(eventMatches(['run.started'], 'run.finished')).toBe(false);
  });
});

describe('WebhookDispatcher', () => {
  it('posts matching events as signed JSON and advances the cursor', async () => {
    const rec = recorder();
    const { h, d } = boot([{ url: 'https://hooks.test/a', events: ['ticket.*'], secret: 'shhh' }], rec.fetchImpl);
    d.start();
    h.bus.emit('ticket.status', 'ticket', 'tk_1', { status: 'done' });
    h.bus.emit('run.started', 'run', 'run_1', {});
    const last = h.bus.emit('ticket.comment', 'ticket', 'tk_1', { body: 'hi' });
    await d.pump();

    expect(rec.deliveries.map((x) => x.headers['X-AgentConductor-Event'])).toEqual(['ticket.status', 'ticket.comment']);
    const first = rec.deliveries[0]!;
    expect(first.url).toBe('https://hooks.test/a');
    expect(first.headers['content-type']).toBe('application/json');
    expect(first.headers['X-AgentConductor-Signature']).toBe(`sha256=${createHmac('sha256', 'shhh').update(first.body).digest('hex')}`);
    expect(JSON.parse(first.body)).toMatchObject({ type: 'ticket.status', entityId: 'tk_1', payload: { status: 'done' } });

    const cursor = h.db.get<{ lastSeq: number }>('SELECT last_seq FROM webhook_cursors WHERE webhook_url = ?', ['https://hooks.test/a']);
    expect(cursor?.lastSeq).toBe(last.seq);
  });

  it('starts a newly declared webhook at the current head instead of replaying history', async () => {
    const rec = recorder();
    const { h, d } = boot([{ url: 'https://hooks.test/b', events: ['*'] }], rec.fetchImpl);
    h.bus.emit('ticket.created', 'ticket', 'tk_old', {});
    d.start();
    await d.pump();
    expect(rec.deliveries).toHaveLength(0);

    h.bus.emit('ticket.created', 'ticket', 'tk_new', {});
    await d.pump();
    expect(rec.deliveries.map((x) => JSON.parse(x.body).entityId)).toEqual(['tk_new']);
  });

  it('omits the signature header when no secret is configured', async () => {
    const rec = recorder();
    const { h, d } = boot([{ url: 'https://hooks.test/c', events: ['*'] }], rec.fetchImpl);
    d.start();
    h.bus.emit('ticket.status', 'ticket', 'tk_1', {});
    await d.pump();
    expect(rec.deliveries[0]!.headers['X-AgentConductor-Signature']).toBeUndefined();
  });

  it('keeps the cursor on a network failure and redelivers the same event (at-least-once)', async () => {
    const rec = recorder({ failTimes: 1 });
    const { h, d } = boot([{ url: 'https://hooks.test/d', events: ['*'] }], rec.fetchImpl);
    d.start();
    const before = h.db.get<{ lastSeq: number }>('SELECT last_seq FROM webhook_cursors WHERE webhook_url = ?', ['https://hooks.test/d'])!.lastSeq;
    const ev = h.bus.emit('ticket.status', 'ticket', 'tk_1', {});
    await d.pump();

    expect(rec.deliveries).toHaveLength(0);
    expect(h.db.get<{ lastSeq: number; lastError: string }>('SELECT last_seq, last_error FROM webhook_cursors WHERE webhook_url = ?', ['https://hooks.test/d']))
      .toMatchObject({ lastSeq: before, lastError: 'ECONNREFUSED' });

    await d.pump();
    expect(rec.deliveries.map((x) => JSON.parse(x.body).seq)).toEqual([ev.seq]);
    expect(h.db.get<{ lastSeq: number; lastError: string | null }>('SELECT last_seq, last_error FROM webhook_cursors WHERE webhook_url = ?', ['https://hooks.test/d']))
      .toMatchObject({ lastSeq: ev.seq, lastError: null });
  });

  it('treats a non-2xx response as a retryable failure', async () => {
    const rec = recorder({ failTimes: 1, mode: 'status' });
    const { h, d } = boot([{ url: 'https://hooks.test/e', events: ['*'] }], rec.fetchImpl);
    d.start();
    h.bus.emit('ticket.status', 'ticket', 'tk_1', {});
    await d.pump();
    expect(h.db.get<{ lastError: string }>('SELECT last_error FROM webhook_cursors WHERE webhook_url = ?', ['https://hooks.test/e'])?.lastError).toBe('HTTP 500');
    await d.pump();
    expect(rec.deliveries).toHaveLength(1);
  });

  it('keeps one request in flight per webhook', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const fetchImpl = (async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    const { h, d } = boot([{ url: 'https://hooks.test/f', events: ['*'] }], fetchImpl);
    d.start();
    for (let i = 0; i < 5; i += 1) h.bus.emit('ticket.status', 'ticket', `tk_${i}`, {});
    await Promise.all([d.pump(), d.pump(), d.pump()]);
    expect(maxConcurrent).toBe(1);
  });

  it('fans one event out to every webhook that matches it', async () => {
    const rec = recorder();
    const { h, d } = boot([
      { url: 'https://hooks.test/g1', events: ['*'] },
      { url: 'https://hooks.test/g2', events: ['decision.created'] },
    ], rec.fetchImpl);
    d.start();
    h.bus.emit('ticket.status', 'ticket', 'tk_1', {});
    h.bus.emit('decision.created', 'decision', 'dec_1', {});
    await d.pump();
    expect(rec.deliveries.filter((x) => x.url.endsWith('g1'))).toHaveLength(2);
    expect(rec.deliveries.filter((x) => x.url.endsWith('g2'))).toHaveLength(1);
  });

  it('does nothing when no webhooks are declared', async () => {
    const rec = recorder();
    const { h, d } = boot([], rec.fetchImpl);
    d.start();
    h.bus.emit('ticket.status', 'ticket', 'tk_1', {});
    await d.pump();
    expect(d.size()).toBe(0);
    expect(rec.deliveries).toHaveLength(0);
  });
});

describe('signBody', () => {
  it('is a hex HMAC-SHA256 of the exact body', () => {
    expect(signBody('k', '{"a":1}')).toBe(`sha256=${createHmac('sha256', 'k').update('{"a":1}').digest('hex')}`);
  });
});
