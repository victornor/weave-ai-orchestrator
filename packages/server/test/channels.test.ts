import { afterEach, describe, expect, it } from 'vitest';
import type { ChannelAdapter, ChannelContext, InboundMessage, OutboundMessage, RejectedContact, SendResult } from '@weave-ai/channel-sdk';
import { newId, nowIso } from '@weave-ai/db';
import { ChannelManager } from '../src/channels.js';
import { makeHarness, decision, type Harness } from './fakes.js';

let harness: Harness | null = null;
let manager: ChannelManager | null = null;
afterEach(async () => { await manager?.stop(); manager = null; await harness?.close(); harness = null; });

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
  harness.runtime.ctx.config.weaver.channels = ['test'];
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

  it('binds a thread with /talk and unbinds with /weaver', async () => {
    const { h, adapter } = await boot();
    await adapter.inbound!({ externalThreadId: 'chat1', externalUserId: 'u1', text: '/talk ACME-42' });
    expect(h.db.get<{ ticketId: string }>('SELECT ticket_id FROM channel_threads LIMIT 1')?.ticketId).toBe('tk_1');
    await adapter.inbound!({ externalThreadId: 'chat1', externalUserId: 'u1', text: '/weaver' });
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

  it('sends a text follow-up on a concerns review, never a second card, and stays quiet on looked (VS-223)', async () => {
    const { h, adapter } = await boot();
    h.runtime.services.threads.bindOrGet('test', 'chat1', 'u1');
    const plan = decision({
      id: 'dec_rev', kind: 'plan_approval', owner: 'human', status: 'open',
      title: 'Approve the plan for ACME-42', weaverReviewStatus: 'unseen',
    });
    (h.impls.decisions!.get as unknown) = () => plan;
    h.bus.emit('decision.created', 'decision', 'dec_rev', plan);
    await new Promise((r) => setTimeout(r, 20));
    await manager!.drain();
    const afterCreate = adapter.sent.length;
    expect(afterCreate).toBeGreaterThan(0);
    expect(adapter.sent.at(-1)!.message.text).toContain('Approve the plan for ACME-42');

    const looked = { ...plan, weaverReviewStatus: 'looked' as const, weaverReviewedAt: '2026-09-11T03:01:00.000Z' };
    (h.impls.decisions!.get as unknown) = () => looked;
    h.bus.emit('decision.updated', 'decision', 'dec_rev', looked);
    await new Promise((r) => setTimeout(r, 20));
    await manager!.drain();
    expect(adapter.sent.length).toBe(afterCreate);

    const concerns = {
      ...plan,
      weaverReviewStatus: 'concerns' as const,
      weaverReviewedAt: '2026-09-11T03:02:00.000Z',
      weaverReviewNote: 'the migration contradicts itself',
    };
    (h.impls.decisions!.get as unknown) = () => concerns;
    h.bus.emit('decision.updated', 'decision', 'dec_rev', concerns);
    await new Promise((r) => setTimeout(r, 20));
    await manager!.drain();
    expect(adapter.sent.length).toBe(afterCreate + 1);
    const followUp = adapter.sent.at(-1)!.message.text;
    expect(followUp).toContain('has concerns');
    expect(followUp).toContain('the migration contradicts itself');
    expect(followUp).not.toContain('/d dec_rev');
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

describe('restartChannel (VS-125)', () => {
  /** Tracks start/stop calls explicitly, unlike `fakeAdapter`, so a restart is unambiguous. */
  function trackingAdapter(): ChannelAdapter & { starts: number; stops: number } {
    const state = {
      kind: 'telegram',
      capabilities: { supportsButtons: false, supportsMarkdown: true, supportsEdit: false, supportsThreads: true, supportsFiles: false, maxTextBytes: 4096 },
      starts: 0,
      stops: 0,
      configSchema: () => ({}),
      validateConfig: () => ({ ok: true as const }),
      async start() { state.starts += 1; return { stop: async () => { state.stops += 1; } }; },
      async send(): Promise<SendResult> { return { delivered: true }; },
    };
    return state as unknown as ChannelAdapter & { starts: number; stops: number };
  }

  it('does not start a configured channel with no resolvable token', async () => {
    harness = makeHarness();
    const adapter = trackingAdapter();
    harness.runtime.ctx.registries.channels.set('telegram', adapter);
    harness.runtime.ctx.config.channels = { telegram: {} };
    wireThreads(harness);
    manager = new ChannelManager(harness.runtime.ctx, harness.runtime.services);
    await manager.start();
    expect(adapter.starts).toBe(0);
  });

  it('restartChannel starts it once a secret-store token resolves, and stops it again once cleared', async () => {
    harness = makeHarness();
    const adapter = trackingAdapter();
    harness.runtime.ctx.registries.channels.set('telegram', adapter);
    harness.runtime.ctx.config.channels = { telegram: {} };
    wireThreads(harness);
    manager = new ChannelManager(harness.runtime.ctx, harness.runtime.services);
    await manager.start();
    expect(adapter.starts).toBe(0);

    harness.runtime.services.secrets!.put({ kind: 'human', id: 'op1' }, { name: 'telegram-bot-token' }, 'T');
    await manager.restartChannel('telegram');
    expect(adapter.starts).toBe(1);
    expect(adapter.stops).toBe(0);

    harness.runtime.services.secrets!.clear({ kind: 'human', id: 'op1' }, 'telegram-bot-token');
    await manager.restartChannel('telegram');
    expect(adapter.starts).toBe(1);
    expect(adapter.stops).toBe(1);
  });

  it('restartChannel stops the running adapter and starts a fresh one when the token changes', async () => {
    harness = makeHarness();
    const adapter = trackingAdapter();
    harness.runtime.ctx.registries.channels.set('telegram', adapter);
    harness.runtime.ctx.config.channels = { telegram: { botToken: 'first' } };
    wireThreads(harness);
    manager = new ChannelManager(harness.runtime.ctx, harness.runtime.services);
    await manager.start();
    expect(adapter.starts).toBe(1);

    harness.runtime.services.secrets!.put({ kind: 'human', id: 'op1' }, { name: 'telegram-bot-token' }, 'second');
    await manager.restartChannel('telegram');
    expect(adapter.starts).toBe(2);
    expect(adapter.stops).toBe(1);
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
    // 'telegram' is a fake stand-in adapter here like 'web' and 'cli' — it needs a token in config
    // only because ChannelManager now resolves one for the literal kind 'telegram' before starting
    // it (VS-125); the fake adapter itself does not care what the value is.
    harness.runtime.ctx.config.channels = Object.fromEntries(KINDS.map((k) => [k, k === 'telegram' ? { botToken: 'test-token' } : {}]));
    harness.runtime.ctx.config.weaver.channels = [...KINDS];
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
    expect(text).toContain('/weaver');
    expect(text).toContain('/d <id> <answer>');
    expect(text).toContain('/help');
    // /help never reaches the agent as a message.
    expect(harness!.db.get('SELECT id FROM thread_messages WHERE direction = ?', ['inbound'])).toBeUndefined();
  });

  it.each(KINDS)('binds and unbinds a thread with /talk and /weaver on %s', async (kind) => {
    const { h, adapters } = await bootKinds();
    const threadId = (): string | null =>
      h.db.get<{ ticketId: string | null }>('SELECT ticket_id FROM channel_threads WHERE external_thread_id = ?', [`chat-${kind}`])?.ticketId ?? null;

    expect(await replyOn(kind, adapters[kind]!, '/talk ACME-42')).toContain('ACME-42');
    expect(threadId()).toBe('tk_1');
    expect(await replyOn(kind, adapters[kind]!, '/weaver')).toContain('Back to the weaver');
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

describe('pending Telegram identities (VS-135)', () => {
  /** Captures `ctx.rejected` so a test can call it the way the Telegram adapter would, and tracks starts to prove a restart happened. */
  function trackingAdapter(): ChannelAdapter & { starts: number; stops: number; rejected: ChannelContext['rejected'] } {
    const state = {
      kind: 'telegram',
      capabilities: { supportsButtons: false, supportsMarkdown: true, supportsEdit: false, supportsThreads: true, supportsFiles: false, maxTextBytes: 4096 },
      starts: 0,
      stops: 0,
      rejected: undefined as ChannelContext['rejected'],
      configSchema: () => ({}),
      validateConfig: () => ({ ok: true as const }),
      async start(ctx: ChannelContext) { state.starts += 1; state.rejected = ctx.rejected; return { stop: async () => { state.stops += 1; } }; },
      async send(): Promise<SendResult> { return { delivered: true }; },
    };
    return state as unknown as ChannelAdapter & { starts: number; stops: number; rejected: ChannelContext['rejected'] };
  }

  async function boot(): Promise<{ h: Harness; adapter: ReturnType<typeof trackingAdapter>; m: ChannelManager }> {
    harness = makeHarness();
    const adapter = trackingAdapter();
    harness.runtime.ctx.registries.channels.set('telegram', adapter);
    harness.runtime.ctx.config.channels = { telegram: { botToken: 'T', allowedUserIds: [] } };
    // The default fake `saveConfig` is a no-op; ChannelManager's approve/disable actions need it to
    // behave like the real loader (packages/core/src/workspace/loader.ts), which reassigns `ctx.config`.
    harness.runtime.ctx.saveConfig = async (next) => { harness!.runtime.ctx.config = next; };
    manager = new ChannelManager(harness.runtime.ctx, harness.runtime.services);
    await manager.start();
    return { h: harness, adapter, m: manager };
  }

  const contact = (id: number, extra: Partial<RejectedContact> = {}): RejectedContact => ({ externalUserId: String(id), username: 'stranger', displayName: 'A Stranger', ...extra });

  it('records a first rejection and appears in the pending list', async () => {
    const { m } = await boot();
    await m.onRejected('telegram', contact(99));
    const pending = m.pendingTelegramUsers();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ externalUserId: '99', username: 'stranger', displayName: 'A Stranger', attemptCount: 1 });
  });

  it('updates the same record on a repeat rejection instead of duplicating', async () => {
    const { m } = await boot();
    await m.onRejected('telegram', contact(99));
    await m.onRejected('telegram', contact(99));
    await m.onRejected('telegram', contact(99));
    const pending = m.pendingTelegramUsers();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.attemptCount).toBe(3);
  });

  it('drops a new identity once at the cap, leaving existing ones untouched', async () => {
    const { h, m } = await boot();
    for (let i = 0; i < 50; i += 1) await m.onRejected('telegram', contact(i));
    await m.onRejected('telegram', contact(999));
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM telegram_pending_users')?.n).toBe(50);
    expect(m.pendingTelegramUsers().some((p) => p.externalUserId === '999')).toBe(false);
    expect(m.pendingTelegramUsers().some((p) => p.externalUserId === '0')).toBe(true);
  });

  it('expires a pending identity 7 days after its last attempt', async () => {
    const { h, m } = await boot();
    await m.onRejected('telegram', contact(1));
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    h.db.run('UPDATE telegram_pending_users SET last_seen_at = ? WHERE external_user_id = ?', [eightDaysAgo, '1']);
    expect(m.pendingTelegramUsers()).toHaveLength(0);
  });

  it('wires the adapter\'s rejected callback to the manager', async () => {
    const { m, adapter } = await boot();
    await adapter.rejected!({ externalUserId: '7' });
    expect(m.pendingTelegramUsers()).toHaveLength(1);
  });

  it('approving adds the id to the allowlist, clears the pending row, and restarts the channel', async () => {
    const { h, m, adapter } = await boot();
    await m.onRejected('telegram', contact(99));
    expect(adapter.starts).toBe(1);

    const result = await m.approveTelegramUser('99');
    expect(result.allowedUserIds).toEqual([99]);
    expect((h.runtime.ctx.config.channels['telegram'] as { allowedUserIds: number[] }).allowedUserIds).toEqual([99]);
    expect(m.pendingTelegramUsers()).toHaveLength(0);
    expect(adapter.starts).toBe(2);
  });

  it('approving the same id twice does not duplicate the allowlist entry', async () => {
    const { m } = await boot();
    await m.approveTelegramUser('99');
    const result = await m.approveTelegramUser('99');
    expect(result.allowedUserIds).toEqual([99]);
  });

  it('rejects a non-numeric id', async () => {
    const { m } = await boot();
    await expect(m.approveTelegramUser('not-a-number')).rejects.toThrow();
  });

  it('disableTelegramAllowAll turns allowAll off and restarts the channel', async () => {
    harness = makeHarness();
    const adapter = trackingAdapter();
    harness.runtime.ctx.registries.channels.set('telegram', adapter);
    harness.runtime.ctx.config.channels = { telegram: { botToken: 'T', allowedUserIds: [], allowAll: true } };
    harness.runtime.ctx.saveConfig = async (next) => { harness!.runtime.ctx.config = next; };
    manager = new ChannelManager(harness.runtime.ctx, harness.runtime.services);
    await manager.start();
    expect(adapter.starts).toBe(1);

    await manager.disableTelegramAllowAll();
    expect((harness.runtime.ctx.config.channels['telegram'] as { allowAll: boolean }).allowAll).toBe(false);
    expect(adapter.starts).toBe(2);
  });

  it('a plain config-patch allowlist edit (not the approve action) restarts only telegram, and an unrelated edit restarts nothing', async () => {
    const { h, adapter } = await boot();
    const next = { ...h.runtime.ctx.config, channels: { ...h.runtime.ctx.config.channels, telegram: { botToken: 'T', allowedUserIds: [42] } } };
    h.runtime.ctx.config = next;
    h.bus.emit('workspace.updated', 'workspace', h.runtime.id, { config: next });
    await new Promise((r) => setTimeout(r, 10));
    expect(adapter.starts).toBe(2);

    h.bus.emit('workspace.updated', 'workspace', h.runtime.id, { config: next });
    await new Promise((r) => setTimeout(r, 10));
    expect(adapter.starts).toBe(2);
  });
});
