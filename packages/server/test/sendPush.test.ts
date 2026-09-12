/**
 * `sendPush` (VS-295): configured/unconfigured behavior, category filtering, per-subscription
 * independence, and dropping a subscription the push service rejects as permanently invalid.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nowIso } from '@weave-ai/db';
import { makeHarness, type Harness } from './fakes.js';

const sendNotification = vi.fn();

class MockWebPushError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WebPushError';
    this.statusCode = statusCode;
  }
}

vi.mock('web-push', () => ({
  default: { sendNotification: (...args: unknown[]) => sendNotification(...args) },
  WebPushError: MockWebPushError,
}));

const { sendPush, listSubscriptions } = await import('../src/push.js');

let harness: Harness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
  sendNotification.mockReset();
});

const KEYS = { publicKey: 'pub', privateKey: 'priv' };

function seed(h: Harness, id: string, categories: string[], endpoint = `https://push.example/${id}`): void {
  h.db.run(
    'INSERT INTO push_subscriptions (id, session_id, endpoint, keys_json, categories_json, created_at) VALUES (?,?,?,?,?,?)',
    [id, 'local', endpoint, JSON.stringify({ p256dh: 'p', auth: 'a' }), JSON.stringify(categories), nowIso()],
  );
}

describe('sendPush', () => {
  it('is a no-op reporting everyone skipped when no key pair is configured', async () => {
    harness = makeHarness();
    seed(harness, 'sub1', ['decisions']);

    const result = await sendPush(harness.db, null, 'decisions', { title: 't', body: 'b', path: '/w/ws1/needs' });

    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends to every subscription whose categories include the one being sent', async () => {
    harness = makeHarness();
    seed(harness, 'sub-in', ['decisions']);
    seed(harness, 'sub-out', ['landed']);
    sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });

    const result = await sendPush(harness.db, KEYS, 'decisions', { title: 't', body: 'b', path: '/w/ws1/needs' });

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0]![0]).toMatchObject({ endpoint: 'https://push.example/sub-in' });
  });

  it('sends the payload with a `path` field the service worker reads', async () => {
    harness = makeHarness();
    seed(harness, 'sub1', ['decisions']);
    sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });

    await sendPush(harness.db, KEYS, 'decisions', { title: 'Merge ACME-12', body: 'Needs a decision', path: '/w/ws1/needs' });

    const payload = JSON.parse(sendNotification.mock.calls[0]![1] as string) as Record<string, unknown>;
    expect(payload).toEqual({ title: 'Merge ACME-12', body: 'Needs a decision', path: '/w/ws1/needs' });
  });

  it('one rejected subscription does not block another', async () => {
    harness = makeHarness();
    seed(harness, 'sub-dead', ['decisions'], 'https://push.example/dead');
    seed(harness, 'sub-live', ['decisions'], 'https://push.example/live');
    sendNotification.mockImplementation((sub: { endpoint: string }) =>
      sub.endpoint.includes('dead') ? Promise.reject(new MockWebPushError('gone', 410)) : Promise.resolve({ statusCode: 201, body: '', headers: {} }),
    );

    const result = await sendPush(harness.db, KEYS, 'decisions', { title: 't', body: 'b', path: '/w/ws1/needs' });

    expect(result).toEqual({ sent: 1, skipped: 1 });
  });

  it('drops a subscription the push service rejects as permanently invalid (404/410)', async () => {
    harness = makeHarness();
    seed(harness, 'sub-dead', ['decisions']);
    sendNotification.mockRejectedValue(new MockWebPushError('gone', 410));

    await sendPush(harness.db, KEYS, 'decisions', { title: 't', body: 'b', path: '/w/ws1/needs' });

    expect(listSubscriptions(harness.db)).toHaveLength(0);
  });

  it('keeps a subscription after a transient failure that is not 404/410', async () => {
    harness = makeHarness();
    seed(harness, 'sub1', ['decisions']);
    sendNotification.mockRejectedValue(new MockWebPushError('server error', 500));

    await sendPush(harness.db, KEYS, 'decisions', { title: 't', body: 'b', path: '/w/ws1/needs' });

    expect(listSubscriptions(harness.db)).toHaveLength(1);
  });
});
