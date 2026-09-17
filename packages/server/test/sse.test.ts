import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { encodeGlobalCursor } from '../src/routes/events.js';
import { authed, makeHarness, ticket, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

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

/** Reads SSE frames off a live stream until `needle` appears, then cancels (for id-less frames). */
async function readUntil(res: Response, needle: string, timeoutMs = 4000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (!buffer.includes(needle) && Date.now() < deadline) {
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

  it('forwards an ephemeral frame without an id and without moving the cursor (VS-328)', async () => {
    harness = makeHarness();
    harness.bus.emit('ticket.created', 'ticket', 'tk_1', ticket());
    harness.bus.emit('ticket.comment', 'ticket', 'tk_1', { id: 'c1' });
    const [first, second] = harness.bus.since(0);
    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/events?after=' + first!.seq, { headers: authed() }));

    const pending = readUntil(res, 'worker.activity');
    setTimeout(() => harness!.bus.broadcast('worker.activity', 'worker', 'ag_1', { agentId: 'ag_1', ticketId: null, activity: null, tests: null }), 20);
    const text = await pending;

    const ephemeral = text.split('\n\n').find((f) => f.includes('event: worker.activity'))!;
    expect(ephemeral).toBeTruthy();
    expect(ephemeral).not.toContain('id:');
    // The replay cursor was not disturbed: the persisted frame after `after` still arrived by seq.
    expect(text).toContain(`id: ${second!.seq}`);
  });
});

describe('global SSE', () => {
  it('requires a session and multiplexes loaded workspaces', async () => {
    harness = makeHarness();
    const second = makeHarness({ workspaceId: 'ws2' });
    harness.deps.workspaces.set('ws2', second.runtime);
    const app = createApp(harness.deps);
    expect((await app.fetch(new Request('http://127.0.0.1/api/events'))).status).toBe(401);

    harness.bus.emit('ticket.created', 'ticket', 'tk_1', ticket());
    second.bus.emit('worker.spawned', 'agent', 'ag_2', { id: 'ag_2' });
    const res = await app.fetch(new Request('http://127.0.0.1/api/events?after=' + encodeGlobalCursor(new Map([['ws1', 0], ['ws2', 0]])), { headers: authed() }));
    const text = await readFrames(res, 2);
    expect(text).toContain('event: ticket.created');
    expect(text).toContain('event: worker.spawned');
    await second.close();
  });

  it('replays each workspace from its cursor and encodes the updated map in ids', async () => {
    harness = makeHarness();
    const second = makeHarness({ workspaceId: 'ws2' });
    harness.deps.workspaces.set('ws2', second.runtime);
    harness.bus.emit('ticket.created', 'ticket', 'tk_1', ticket());
    harness.bus.emit('ticket.comment', 'ticket', 'tk_1', { id: 'c1' });
    second.bus.emit('worker.spawned', 'agent', 'ag_2', { id: 'ag_2' });
    const first = harness.bus.since(0)[0]!;
    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/events?after=' + encodeGlobalCursor(new Map([['ws1', first.seq], ['ws2', 0]])), { headers: authed() }));
    const text = await readFrames(res, 2);
    expect(text).toContain('event: ticket.comment');
    expect(text).toContain('event: worker.spawned');
    expect(text).toMatch(/id: [A-Za-z0-9_-]+/);
    expect(text).not.toContain('event: ticket.created');
    await second.close();
  });

  it('forwards ephemeral frames without moving the per-workspace cursor', async () => {
    harness = makeHarness();
    const cursor = encodeGlobalCursor(new Map([['ws1', 0]]));
    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/events?after=' + cursor, { headers: authed() }));
    const pending = readUntil(res, 'worker.activity');
    setTimeout(() => harness!.bus.broadcast('worker.activity', 'worker', 'ag_1', { agentId: 'ag_1', ticketId: null, activity: null, tests: null }), 20);
    const text = await pending;
    const frame = text.split('\n\n').find((f) => f.includes('event: worker.activity'))!;
    expect(frame).not.toContain('id:');
  });
});
