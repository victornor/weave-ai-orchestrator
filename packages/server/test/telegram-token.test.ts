/**
 * `POST/DELETE/GET /w/:ws/channels/telegram/token` (VS-125): set, clear and read the Telegram bot
 * token's status. `getMe` is faked via `vi.stubGlobal('fetch', ...)` — `TelegramClient` has no
 * injection point through the route, and nothing here ever calls the real Telegram API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter, SendResult } from '@agent-conductor/channel-sdk';
import { createApp } from '../src/app.js';
import { ChannelManager } from '../src/channels.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
let manager: ChannelManager | null = null;
afterEach(async () => { await manager?.stop(); manager = null; harness?.close(); harness = null; vi.unstubAllGlobals(); });

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

function fakeTelegramFetch(responder: (method: string) => { status?: number; body: Record<string, unknown> }): void {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const method = String(input).split('/').pop() ?? '';
    const res = responder(method);
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'content-type': 'application/json' } });
  }));
}

describe('telegram token route', () => {
  let h: Harness;
  let adapter: ReturnType<typeof trackingAdapter>;
  let fetchApp: (path: string, init?: RequestInit) => Promise<Response>;

  beforeEach(async () => {
    harness = makeHarness();
    h = harness;
    adapter = trackingAdapter();
    h.runtime.ctx.registries.channels.set('telegram', adapter);
    manager = new ChannelManager(h.runtime.ctx, h.runtime.services);
    h.runtime.channels = manager;
    await manager.start();
    fetchApp = (path, init) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init));
  });

  it('GET reports not configured before anything is set', async () => {
    const res = await fetchApp('/api/w/ws1/channels/telegram/token', { headers: authed() });
    expect(await res.json()).toEqual({ configured: false, source: null, botUsername: null });
  });

  it('POST validates against getMe, registers the secret, and starts the channel', async () => {
    fakeTelegramFetch((method) => (method === 'getMe' ? { body: { ok: true, result: { id: 1, username: 'acme_bot' } } } : { body: { ok: true, result: true } }));
    const res = await fetchApp('/api/w/ws1/channels/telegram/token', { method: 'POST', headers: { ...authed(), 'content-type': 'application/json' }, body: JSON.stringify({ token: 'a-real-looking-token' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, botUsername: 'acme_bot' });
    expect(adapter.starts).toBe(1);
    expect(h.runtime.services.secrets!.has('telegram-bot-token')).toBe(true);

    const status = await fetchApp('/api/w/ws1/channels/telegram/token', { headers: authed() });
    const statusBody = await status.json();
    expect(statusBody).toEqual({ configured: true, source: 'secret', botUsername: 'acme_bot' });
    expect(JSON.stringify(statusBody)).not.toContain('a-real-looking-token');
  });

  it('a persisted bot username survives a fresh ChannelManager instance over the same db (not held only in memory)', async () => {
    fakeTelegramFetch(() => ({ body: { ok: true, result: { id: 1, username: 'acme_bot' } } }));
    await fetchApp('/api/w/ws1/channels/telegram/token', { method: 'POST', headers: { ...authed(), 'content-type': 'application/json' }, body: JSON.stringify({ token: 'a-real-looking-token' }) });

    // Simulate a process restart: a brand-new ChannelManager over the same underlying db.
    await manager!.stop();
    const restarted = new ChannelManager(h.runtime.ctx, h.runtime.services);
    h.runtime.channels = restarted;
    manager = restarted;
    expect(restarted.telegramBotUsername()).toBe('acme_bot');
  });

  it('POST rejects a bad token, writes nothing, and does not disturb a previously working one', async () => {
    fakeTelegramFetch(() => ({ body: { ok: true, result: { id: 1, username: 'good_bot' } } }));
    await fetchApp('/api/w/ws1/channels/telegram/token', { method: 'POST', headers: { ...authed(), 'content-type': 'application/json' }, body: JSON.stringify({ token: 'good-token' }) });
    expect(adapter.starts).toBe(1);

    fakeTelegramFetch((method) => (method === 'getMe' ? { status: 401, body: { ok: false, description: 'Unauthorized' } } : { body: { ok: true, result: true } }));
    const bad = await fetchApp('/api/w/ws1/channels/telegram/token', { method: 'POST', headers: { ...authed(), 'content-type': 'application/json' }, body: JSON.stringify({ token: 'bad-token-value' }) });
    expect(bad.status).toBe(400);
    const errorBody = await bad.text();
    expect(errorBody).toContain('Unauthorized');
    expect(errorBody).not.toContain('bad-token-value');
    expect(errorBody).not.toContain('good-token');

    // Unchanged: still the good token, channel not restarted a second time.
    expect(adapter.starts).toBe(1);
    const status = await fetchApp('/api/w/ws1/channels/telegram/token', { headers: authed() });
    expect(await status.json()).toMatchObject({ configured: true, botUsername: 'good_bot' });
  });

  it('DELETE clears the token and stops the channel', async () => {
    fakeTelegramFetch(() => ({ body: { ok: true, result: { id: 1, username: 'acme_bot' } } }));
    await fetchApp('/api/w/ws1/channels/telegram/token', { method: 'POST', headers: { ...authed(), 'content-type': 'application/json' }, body: JSON.stringify({ token: 'a-real-looking-token' }) });
    expect(adapter.starts).toBe(1);

    const res = await fetchApp('/api/w/ws1/channels/telegram/token', { method: 'DELETE', headers: authed() });
    expect(res.status).toBe(200);
    expect(adapter.stops).toBe(1);
    expect(h.runtime.services.secrets!.has('telegram-bot-token')).toBe(false);

    const status = await fetchApp('/api/w/ws1/channels/telegram/token', { headers: authed() });
    expect(await status.json()).toEqual({ configured: false, source: null, botUsername: null });
  });
});
