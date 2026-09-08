/**
 * `GET /channels/telegram/pending`, `POST /channels/telegram/pending/:id/approve` and
 * `POST /channels/telegram/allow-all/disable` (VS-135): the interface side of recording an
 * unrecognised Telegram sender's identity and letting captain approve one without typing a user id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ChannelAdapter, SendResult } from '@agent-conductor/channel-sdk';
import { createApp } from '../src/app.js';
import { ChannelManager } from '../src/channels.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
let manager: ChannelManager | null = null;
afterEach(async () => { await manager?.stop(); manager = null; harness?.close(); harness = null; });

function trackingAdapter(): ChannelAdapter & { starts: number } {
  const state = {
    kind: 'telegram',
    capabilities: { supportsButtons: false, supportsMarkdown: true, supportsEdit: false, supportsThreads: true, supportsFiles: false, maxTextBytes: 4096 },
    starts: 0,
    configSchema: () => ({}),
    validateConfig: () => ({ ok: true as const }),
    async start() { state.starts += 1; return { stop: async () => undefined }; },
    async send(): Promise<SendResult> { return { delivered: true }; },
  };
  return state as unknown as ChannelAdapter & { starts: number };
}

async function boot(configOverrides: Record<string, unknown> = {}): Promise<{ h: Harness; adapter: ReturnType<typeof trackingAdapter>; fetchApp: (path: string, init?: RequestInit) => Promise<Response> }> {
  harness = makeHarness();
  const h = harness;
  const adapter = trackingAdapter();
  h.runtime.ctx.registries.channels.set('telegram', adapter);
  h.runtime.ctx.config.channels = { telegram: { botToken: 'T', allowedUserIds: [], ...configOverrides } };
  h.runtime.ctx.saveConfig = async (next) => { h.runtime.ctx.config = next; };
  manager = new ChannelManager(h.runtime.ctx, h.runtime.services);
  h.runtime.channels = manager;
  await manager.start();
  const fetchApp = (path: string, init?: RequestInit): Promise<Response> => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init));
  return { h, adapter, fetchApp };
}

describe('telegram pending route', () => {
  it('GET reports an empty list before anyone has been rejected', async () => {
    const { fetchApp } = await boot();
    const res = await fetchApp('/api/w/ws1/channels/telegram/pending', { headers: authed() });
    expect(await res.json()).toEqual({ pending: [] });
  });

  it('GET lists a recorded identity, and never the message that triggered it', async () => {
    const { fetchApp } = await boot();
    await manager!.onRejected('telegram', { externalUserId: '99', username: 'stranger', displayName: 'Sam' });
    const res = await fetchApp('/api/w/ws1/channels/telegram/pending', { headers: authed() });
    const body = await res.json() as { pending: Array<Record<string, unknown>> };
    expect(body.pending).toHaveLength(1);
    expect(body.pending[0]).toMatchObject({ externalUserId: '99', username: 'stranger', displayName: 'Sam', attemptCount: 1 });
    expect(JSON.stringify(body)).not.toContain('text');
  });

  it('POST approve adds the id to the allowlist, clears the pending row, and restarts the channel', async () => {
    const { h, adapter, fetchApp } = await boot();
    await manager!.onRejected('telegram', { externalUserId: '99' });
    expect(adapter.starts).toBe(1);

    const res = await fetchApp('/api/w/ws1/channels/telegram/pending/99/approve', { method: 'POST', headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowedUserIds: [99] });
    expect((h.runtime.ctx.config.channels['telegram'] as { allowedUserIds: number[] }).allowedUserIds).toEqual([99]);
    expect(adapter.starts).toBe(2);

    const pending = await fetchApp('/api/w/ws1/channels/telegram/pending', { headers: authed() });
    expect(await pending.json()).toEqual({ pending: [] });
  });

  it('POST approve twice for the same id does not duplicate the allowlist entry', async () => {
    const { fetchApp } = await boot();
    await fetchApp('/api/w/ws1/channels/telegram/pending/99/approve', { method: 'POST', headers: authed() });
    const res = await fetchApp('/api/w/ws1/channels/telegram/pending/99/approve', { method: 'POST', headers: authed() });
    expect(await res.json()).toEqual({ allowedUserIds: [99] });
  });

  it('POST approve with a non-numeric id is rejected', async () => {
    const { fetchApp } = await boot();
    const res = await fetchApp('/api/w/ws1/channels/telegram/pending/not-a-number/approve', { method: 'POST', headers: authed() });
    expect(res.status).toBe(400);
  });
});

describe('telegram allow-all disable route', () => {
  it('POST turns allowAll off and restarts the channel', async () => {
    const { h, adapter, fetchApp } = await boot({ allowAll: true });
    expect(adapter.starts).toBe(1);

    const res = await fetchApp('/api/w/ws1/channels/telegram/allow-all/disable', { method: 'POST', headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((h.runtime.ctx.config.channels['telegram'] as { allowAll: boolean }).allowAll).toBe(false);
    expect(adapter.starts).toBe(2);
  });
});
