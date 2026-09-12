/**
 * The web app's push paths and the daemon's push routes are the same constants, and this test is
 * what keeps them that way: it asks for exactly what `packages/ui/src/lib/push.ts` asks for.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { pushPath } from '@weave-ai/shared';
import { createApp } from '../src/app.js';
import { ROUTES } from '../src/routetable.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(() => { harness?.close(); harness = null; });

const app = (opts?: Parameters<typeof makeHarness>[0]) => {
  const h = (harness = makeHarness(opts));
  return { h, fetch: (path: string, init?: RequestInit) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api/w/ws1${path}`, init)) };
};

const subscription = { endpoint: 'https://push.example/dev-1', keys: { p256dh: 'key', auth: 'auth' } };
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify(body) });

describe('push routes', () => {
  it('serves every path the web app asks for', async () => {
    const { fetch } = app();

    const config = await fetch(pushPath.config, { headers: authed() });
    expect(config.status).toBe(200);

    const list = await fetch(pushPath.subscriptions, { headers: authed() });
    expect(list.status).toBe(200);

    const created = await fetch(pushPath.subscriptions, post(subscription));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const removed = await fetch(pushPath.subscription(id), { method: 'DELETE', headers: authed() });
    expect(removed.status).toBe(200);
  });

  it('documents those paths in the route table', () => {
    const paths = ROUTES.filter((r) => r.tag === 'push').map((r) => r.path);
    expect(paths).toContain(`/api/w/{ws}${pushPath.config}`);
    expect(paths).toContain(`/api/w/{ws}${pushPath.subscriptions}`);
    expect(paths).toContain(`/api/w/{ws}${pushPath.subscriptions}/{id}`);
  });

  it('reports push as unconfigured until the daemon has a VAPID key', async () => {
    const bare = app();
    await expect((await bare.fetch(pushPath.config, { headers: authed() })).json()).resolves.toEqual({ configured: false, vapidPublicKey: null });
    bare.h.close();

    const keyed = app({ daemon: { push: { vapidPublicKey: 'BKey' } } });
    await expect((await keyed.fetch(pushPath.config, { headers: authed() })).json()).resolves.toEqual({ configured: true, vapidPublicKey: 'BKey' });
  });

  it('registers a subscription and forgets it again', async () => {
    const { fetch } = app();
    const created = await fetch(pushPath.subscriptions, post(subscription));
    const { id } = (await created.json()) as { id: string };

    const listed = (await (await fetch(pushPath.subscriptions, { headers: authed() })).json()) as Array<{ id: string; endpoint: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id, endpoint: subscription.endpoint });

    await fetch(pushPath.subscription(id), { method: 'DELETE', headers: authed() });
    await expect((await fetch(pushPath.subscriptions, { headers: authed() })).json()).resolves.toEqual([]);
  });
});
