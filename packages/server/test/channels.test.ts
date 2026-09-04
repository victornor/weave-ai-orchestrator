import { afterEach, describe, expect, it } from 'vitest';
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '@openconductor/channel-sdk';
import { newId, nowIso } from '@openconductor/db';
import { ChannelManager } from '../src/channels.js';
import { makeHarness, decision, type Harness } from './fakes.js';

let harness: Harness | null = null;
let manager: ChannelManager | null = null;
afterEach(async () => { await manager?.stop(); manager = null; harness?.close(); harness = null; });

/** Text-only adapter (no buttons) so `degrade()` is exercised on decision cards. */
function fakeAdapter(): ChannelAdapter & { sent: OutboundMessage[]; inbound: ((m: InboundMessage) => Promise<void>) | null; fail: boolean } {
  const state = {
    kind: 'test',
    capabilities: { supportsButtons: false, supportsMarkdown: true, supportsEdit: false, supportsThreads: true, supportsFiles: false, maxTextBytes: 4096 },
    sent: [] as OutboundMessage[],
    inbound: null as ((m: InboundMessage) => Promise<void>) | null,
    fail: false,
    configSchema: () => ({}),
    validateConfig: () => ({ ok: true as const }),
    async start(ctx: { inbound(m: InboundMessage): Promise<void> }) { state.inbound = ctx.inbound; return { stop: async () => undefined }; },
    async send(msg: OutboundMessage): Promise<SendResult> {
      if (state.fail) return { delivered: false, error: { code: 'rate_limited', retryable: true, message: 'slow down' } };
      state.sent.push(msg);
      return { delivered: true, externalMessageId: `ext_${state.sent.length}` };
    },
  };
  return state as unknown as ChannelAdapter & { sent: OutboundMessage[]; inbound: ((m: InboundMessage) => Promise<void>) | null; fail: boolean };
}

/** Installs a db-backed `threads` fake so the manager's real SQL runs against real rows. */
function wireThreads(h: Harness): void {
  const db = h.runtime.ctx.db;
  const channelId = (kind: string): string =>
    db.get<{ id: string }>('SELECT id FROM channels WHERE workspace_id = ? AND kind = ?', [h.runtime.id, kind])!.id;
  Object.assign(h.impls.threads!, {
    bindOrGet: (kind: string, externalThreadId: string, externalUserId: string | null, label?: string) => {
      const cid = channelId(kind);
      const found = db.get<{ id: string }>('SELECT id FROM channel_threads WHERE channel_id = ? AND external_thread_id = ?', [cid, externalThreadId]);
      if (found) return { id: found.id, channelId: cid, ticketId: null, externalThreadId };
      const id = newId();
      db.run('INSERT INTO channel_threads (id, channel_id, agent_id, external_thread_id, external_user_id, human_label, is_primary, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [id, cid, 'ag_conductor', externalThreadId, externalUserId, label ?? null, 1, nowIso()]);
      return { id, channelId: cid, ticketId: null, externalThreadId };
    },
    primaryThread: () => db.get<{ id: string }>('SELECT id FROM channel_threads WHERE is_primary = 1 LIMIT 1') ?? null,
    bindTicket: (_actor: unknown, threadId: string, ticketId: string | null) => {
      db.run('UPDATE channel_threads SET ticket_id = ? WHERE id = ?', [ticketId, threadId]);
      return { id: threadId, ticketId };
    },
    inbound: async (_actor: unknown, threadId: string, body: string) => {
      const id = newId();
      db.run('INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, created_at) VALUES (?,?,?,?,?,?)', [id, threadId, 'inbound', 'human', body, nowIso()]);
      return { id, body };
    },
    outbound: async (_actor: unknown, threadId: string, body: string, opts?: { parts?: unknown[] }) => {
      const id = newId();
      db.run('INSERT INTO thread_messages (id, thread_id, direction, author_kind, body, parts_json, delivery_status, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [id, threadId, 'outbound', 'agent', body, JSON.stringify(opts?.parts ?? []), 'pending', nowIso()]);
      h.bus.emit('thread.message', 'thread_message', id, { id, threadId });
      return { id, body };
    },
  });
}

async function boot(): Promise<{ h: Harness; adapter: ReturnType<typeof fakeAdapter>; m: ChannelManager }> {
  harness = makeHarness();
  const adapter = fakeAdapter();
  harness.runtime.ctx.registries.channels.set('test', adapter);
  harness.runtime.ctx.config.channels = { test: {} };
  harness.runtime.ctx.config.conductor.channels = ['test'];
  wireThreads(harness);
  manager = new ChannelManager(harness.runtime.ctx, harness.runtime.services);
  await manager.start();
  return { h: harness, adapter, m: manager };
}

describe('ChannelManager', () => {
  it('starts configured adapters and records the channel row', async () => {
    const { h, adapter } = await boot();
    expect(adapter.inbound).toBeTypeOf('function');
    expect(h.db.get('SELECT kind FROM channels WHERE workspace_id = ?', ['ws1'])).toMatchObject({ kind: 'test' });
  });

  it('routes an inbound message into threads.inbound', async () => {
    const { h, adapter } = await boot();
    await adapter.inbound!({ externalThreadId: 'chat1', externalUserId: 'u1', text: 'add dark mode' });
    expect(h.db.get('SELECT body, direction FROM thread_messages WHERE direction = ?', ['inbound'])).toMatchObject({ body: 'add dark mode' });
  });

  it('binds a thread with /talk and unbinds with /conductor', async () => {
    const { h, adapter } = await boot();
    await adapter.inbound!({ externalThreadId: 'chat1', externalUserId: 'u1', text: '/talk ACME-42' });
    expect(h.db.get<{ ticketId: string }>('SELECT ticket_id FROM channel_threads LIMIT 1')?.ticketId).toBe('tk_1');
    await adapter.inbound!({ externalThreadId: 'chat1', externalUserId: 'u1', text: '/conductor' });
    expect(h.db.get<{ ticketId: string | null }>('SELECT ticket_id FROM channel_threads LIMIT 1')?.ticketId).toBeNull();
  });

  it('answers a decision from a button payload and from /d', async () => {
    const { h, adapter } = await boot();
    await adapter.inbound!({ externalThreadId: 'chat1', externalUserId: 'u1', text: '', action: { decisionId: 'dec_1', key: 'vars' } });
    expect(h.calls.some((c) => c.service === 'decisions' && c.method === 'answer' && (c.args[2] as { key: string }).key === 'vars')).toBe(true);

    await adapter.inbound!({ externalThreadId: 'chat1', externalUserId: 'u1', text: '/d dec_1 2' });
    const byNumber = h.calls.filter((c) => c.method === 'answer').at(-1);
    expect((byNumber!.args[2] as { key: string }).key).toBe('tw');   // numbered option from degrade()
  });

  it('delivers pending outbound rows and marks them delivered', async () => {
    const { h, adapter } = await boot();
    const threads = h.runtime.services.threads;
    const thread = threads.bindOrGet('test', 'chat1', 'u1');
    await threads.outbound({ kind: 'agent', id: 'ag_1' }, thread.id, 'shipped it');
    await manager!.drain();
    expect(adapter.sent.map((m) => m.message.text)).toContain('shipped it');
    expect(h.db.get<{ deliveryStatus: string; externalMessageId: string }>('SELECT delivery_status, external_message_id FROM thread_messages WHERE direction = ?', ['outbound']))
      .toMatchObject({ deliveryStatus: 'delivered' });
  });

  it('degrades a human decision card to numbered text on the primary thread', async () => {
    const { h, adapter } = await boot();
    h.runtime.services.threads.bindOrGet('test', 'chat1', 'u1');
    (h.impls.decisions!.get as unknown) = () => decision({ id: 'dec_7' });
    h.bus.emit('decision.created', 'decision', 'dec_7', { id: 'dec_7' });
    await new Promise((r) => setTimeout(r, 20));
    await manager!.drain();
    const text = adapter.sent.at(-1)!.message.text;
    expect(text).toContain('CSS variables or Tailwind?');
    expect(text).toContain('1. CSS variables');
    expect(text).toContain('/d dec_7');
  });

  it('retries a retryable failure and gives up after MAX_ATTEMPTS', async () => {
    const { h, adapter } = await boot();
    adapter.fail = true;
    const thread = h.runtime.services.threads.bindOrGet('test', 'chat1', 'u1');
    await h.runtime.services.threads.outbound({ kind: 'agent', id: 'ag_1' }, thread.id, 'never lands');
    for (let i = 0; i < 6; i += 1) await manager!.drain();
    const row = h.db.get<{ deliveryStatus: string; attempts: number }>('SELECT delivery_status, attempts FROM thread_messages WHERE direction = ?', ['outbound']);
    expect(row?.deliveryStatus).toBe('failed');
    expect(row?.attempts).toBe(5);
  });
});

/** PLAN §14.2: the manager owns the commands, so every channel kind gets the same set. */
describe('manager commands on every channel kind', () => {
  const KINDS = ['web', 'cli', 'telegram'] as const;

  async function bootKinds(): Promise<{ h: Harness; adapters: Record<string, ReturnType<typeof fakeAdapter>> }> {
    harness = makeHarness();
    const adapters: Record<string, ReturnType<typeof fakeAdapter>> = {};
    for (const kind of KINDS) {
      const adapter = fakeAdapter();
      (adapter as unknown as { kind: string }).kind = kind;
      adapters[kind] = adapter;
      harness.runtime.ctx.registries.channels.set(kind, adapter);
    }
    harness.runtime.ctx.config.channels = Object.fromEntries(KINDS.map((k) => [k, {}]));
    harness.runtime.ctx.config.conductor.channels = [...KINDS];
    wireThreads(harness);
    manager = new ChannelManager(harness.runtime.ctx, harness.runtime.services);
    await manager.start();
    return { h: harness, adapters };
  }

  /** The reply the manager queued for a thread, drained through the owning adapter. */
  async function replyOn(kind: string, adapter: ReturnType<typeof fakeAdapter>, text: string): Promise<string> {
    await adapter.inbound!({ externalThreadId: `chat-${kind}`, externalUserId: 'u1', text });
    await manager!.drain();
    return adapter.sent.at(-1)?.message.text ?? '';
  }

  it.each(KINDS)('answers /help on %s', async (kind) => {
    const { adapters } = await bootKinds();
    const text = await replyOn(kind, adapters[kind]!, '/help');
    expect(text).toContain('/talk <ticket>');
    expect(text).toContain('/conductor');
    expect(text).toContain('/d <id> <answer>');
    expect(text).toContain('/help');
    // /help never reaches the agent as a message.
    expect(harness!.db.get('SELECT id FROM thread_messages WHERE direction = ?', ['inbound'])).toBeUndefined();
  });

  it.each(KINDS)('binds and unbinds a thread with /talk and /conductor on %s', async (kind) => {
    const { h, adapters } = await bootKinds();
    const threadId = (): string | null =>
      h.db.get<{ ticketId: string | null }>('SELECT ticket_id FROM channel_threads WHERE external_thread_id = ?', [`chat-${kind}`])?.ticketId ?? null;

    expect(await replyOn(kind, adapters[kind]!, '/talk ACME-42')).toContain('ACME-42');
    expect(threadId()).toBe('tk_1');
    expect(await replyOn(kind, adapters[kind]!, '/conductor')).toContain('Back to the conductor');
    expect(threadId()).toBeNull();
  });

  it.each(KINDS)('answers a decision with /d on %s', async (kind) => {
    const { h, adapters } = await bootKinds();
    expect(await replyOn(kind, adapters[kind]!, '/d dec_1 vars')).toContain('Recorded: vars');
    expect(h.calls.some((c) => c.service === 'decisions' && c.method === 'answer' && (c.args[2] as { key?: string }).key === 'vars')).toBe(true);
  });

  it('passes anything that is not a command through to the agent', async () => {
    const { h, adapters } = await bootKinds();
    await adapters.telegram!.inbound!({ externalThreadId: 'chat-telegram', externalUserId: 'u1', text: 'ship the thing' });
    expect(h.db.get<{ body: string }>('SELECT body FROM thread_messages WHERE direction = ?', ['inbound'])?.body).toBe('ship the thing');
  });
});
