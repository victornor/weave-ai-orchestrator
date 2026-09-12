/**
 * The web app's half of the route pinning: what `enablePush`/`disablePush` actually ask the daemon
 * for. `packages/server/test/push.test.ts` asks for the same paths and gets a route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disablePush, enablePush, subscriptionId, updatePushCategories } from '../lib/push';

interface Call { url: string; method: string; body: unknown }

const calls: Call[] = [];
let unsubscribed = false;
let existing: unknown = null;
let config: unknown = { configured: true, vapidPublicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' };
let permission: NotificationPermission = 'granted';

const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://push.example/dev-1', keys: { p256dh: 'k', auth: 'a' } }) }));

function respond(url: string): Response {
  if (url.endsWith('/push/config')) return new Response(JSON.stringify(config), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/push/subscriptions')) return new Response(JSON.stringify({ id: 'sub_1' }), { status: 201, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls.length = 0;
  unsubscribed = false;
  existing = null;
  permission = 'granted';
  config = { configured: true, vapidPublicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' };
  subscribe.mockClear();
  localStorage.clear();

  vi.stubGlobal('Notification', { requestPermission: async () => permission, permission });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return respond(url);
  }));
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => existing, subscribe } }) },
  });
  (window as unknown as { PushManager: unknown }).PushManager = class {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('enablePush', () => {
  it('registers the subscription on the route the daemon mounts', async () => {
    await enablePush('ws1');

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/w/ws1/push/config',
      'POST /api/w/ws1/push/subscriptions',
    ]);
    expect(calls[1]?.body).toMatchObject({ endpoint: 'https://push.example/dev-1' });
    expect(subscriptionId('ws1')).toBe('sub_1');
  });

  it('subscribes with the daemon`s VAPID key', async () => {
    await enablePush('ws1');
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }));
  });

  it('says push is not configured when the daemon has no VAPID key', async () => {
    config = { configured: false, vapidPublicKey: null };
    await expect(enablePush('ws1')).rejects.toThrow(/not configured on the daemon/i);
    expect(calls.map((c) => c.url)).toEqual(['/api/w/ws1/push/config']);
  });

  it('surfaces the daemon`s error instead of swallowing it', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'not_found', message: 'no route for POST /api/w/ws1/push/subscribe' } }), { status: 404 }));
    await expect(enablePush('ws1')).rejects.toThrow('no route for POST /api/w/ws1/push/subscribe');
  });

  it('says so when the human refused permission', async () => {
    permission = 'denied';
    vi.stubGlobal('Notification', { requestPermission: async () => permission, permission });
    await expect(enablePush('ws1')).rejects.toThrow(/blocked/i);
    expect(calls).toHaveLength(0);
  });

  it('registers with the caller`s category selection', async () => {
    await enablePush('ws1', ['decisions']);
    expect(calls[1]?.body).toMatchObject({ categories: ['decisions'] });
  });

  it('defaults to the Settings toggle defaults when no categories are given', async () => {
    await enablePush('ws1');
    expect(calls[1]?.body).toMatchObject({ categories: ['decisions', 'landed'] });
  });
});

describe('updatePushCategories', () => {
  it('re-registers the existing subscription with a new category set', async () => {
    await enablePush('ws1');
    calls.length = 0;
    existing = { toJSON: () => ({ endpoint: 'https://push.example/dev-1', keys: { p256dh: 'k', auth: 'a' } }) };

    await updatePushCategories('ws1', ['decisions']);

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/w/ws1/push/subscriptions']);
    expect(calls[0]?.body).toMatchObject({ endpoint: 'https://push.example/dev-1', categories: ['decisions'] });
  });

  it('is a no-op when this device is not subscribed', async () => {
    existing = null;
    await updatePushCategories('ws1', ['decisions']);
    expect(calls).toHaveLength(0);
  });
});

describe('disablePush', () => {
  it('unsubscribes the browser and deletes the daemon`s record', async () => {
    await enablePush('ws1');
    calls.length = 0;
    existing = { unsubscribe: async () => { unsubscribed = true; return true; } };

    await disablePush('ws1');

    expect(unsubscribed).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['DELETE /api/w/ws1/push/subscriptions/sub_1']);
    expect(subscriptionId('ws1')).toBeNull();
  });
});
