import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authed, makeHarness, ticket, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(() => { harness?.close(); harness = null; });

/** Reads SSE frames off a live stream until `count` `id:` lines have arrived, then cancels. */
async function readFrames(res: Response, count: number, timeoutMs = 4000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while ((buffer.match(/^id: /gm)?.length ?? 0) < count && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now()))]);
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return buffer;
}

describe('workspace SSE', () => {
  it('replays the outbox from ?after= and frames carry id: seq', async () => {
    harness = makeHarness();
    harness.bus.emit('ticket.created', 'ticket', 'tk_1', ticket());
    harness.bus.emit('ticket.status', 'ticket', 'tk_1', { id: 'tk_1', status: 'todo' });
    harness.bus.emit('decision.created', 'decision', 'dec_1', { id: 'dec_1' });
    const seqs = harness.bus.since(0).map((e) => e.seq);
    expect(seqs).toHaveLength(3);

    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/events?after=' + seqs[0], { headers: authed() }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await readFrames(res, 2);
    expect(text).toContain(`id: ${seqs[1]}`);
    expect(text).toContain(`id: ${seqs[2]}`);
    expect(text).not.toContain(`id: ${seqs[0]}`);
    expect(text).toContain('event: ticket.status');
    expect(text).toContain('event: decision.created');
  });

  it('tails events emitted after the stream opened', async () => {
    harness = makeHarness();
    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/events', { headers: authed() }));
    const pending = readFrames(res, 1);
    setTimeout(() => harness!.bus.emit('worker.spawned', 'agent', 'ag_9', { id: 'ag_9' }), 20);
    expect(await pending).toContain('event: worker.spawned');
  });

  it('resumes from Last-Event-ID when ?after= is absent', async () => {
    harness = makeHarness();
    harness.bus.emit('ticket.created', 'ticket', 'tk_1', ticket());
    harness.bus.emit('ticket.comment', 'ticket', 'tk_1', { id: 'c1' });
    const [first] = harness.bus.since(0);
    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/events', { headers: authed({ 'last-event-id': String(first!.seq) }) }));
    const text = await readFrames(res, 1);
    expect(text).toContain('event: ticket.comment');
    expect(text).not.toContain('event: ticket.created');
  });
});
