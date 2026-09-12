/**
 * Web push subscriptions for the PWA (§4.4). Storage and delivery are both real (VS-295): a
 * subscription carries its own category selection, and `sendPush` signs and delivers with the
 * daemon's own VAPID key pair (`vapid.ts`) whenever one is configured.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import webPush, { WebPushError } from 'web-push';
import { newId, nowIso, type Db } from '@weave-ai/db';
import { getLogger } from '@weave-ai/core';
import { PUSH_ROUTES, PUSH_CATEGORIES, DEFAULT_PUSH_CATEGORIES, type PushCategory, type PushConfig } from '@weave-ai/shared';
import type { AppDeps, AppEnv } from './types.js';
import type { PushKeys } from './vapid.js';
import { body } from './http.js';

const log = getLogger('http', { component: 'push' });

/** Not dereferenced by push services in the general case — an abuse-contact identity, not a live endpoint. */
const VAPID_SUBJECT = 'mailto:push@weave.invalid';

export interface PushSubscriptionRow { id: string; sessionId: string; endpoint: string; keys: Record<string, string>; categories: PushCategory[]; createdAt: string }

interface SubscriptionRawRow { id: string; sessionId: string; endpoint: string; keys: Record<string, string>; categories: unknown; createdAt: string }

/** `*_json` columns already arrive parsed (`Db`'s own row mapping); this only guards against a corrupt or pre-migration value. */
function normalizeCategories(raw: unknown): PushCategory[] {
  if (!Array.isArray(raw)) return DEFAULT_PUSH_CATEGORIES;
  return raw.filter((c): c is PushCategory => (PUSH_CATEGORIES as readonly string[]).includes(c));
}

export function listSubscriptions(db: Db): PushSubscriptionRow[] {
  return db
    .all<SubscriptionRawRow>('SELECT id, session_id, endpoint, keys_json, categories_json, created_at FROM push_subscriptions ORDER BY created_at')
    .map((r) => ({ id: r.id, sessionId: r.sessionId, endpoint: r.endpoint, keys: r.keys, categories: normalizeCategories(r.categories), createdAt: r.createdAt }));
}

function deleteSubscription(db: Db, id: string): void {
  db.run('DELETE FROM push_subscriptions WHERE id = ?', [id]);
}

/**
 * Delivers `payload` under `category` to every subscription in `db` that has it enabled. With no
 * key pair (daemon not yet configured), this is a no-op reporting everyone as skipped — the same
 * shape as before VAPID keys existed, so an unconfigured daemon behaves exactly as it always has.
 * A subscription whose endpoint the push service rejects as permanently invalid (404/410 — the key
 * pair it was registered against is gone, or the browser dropped it) is deleted rather than retried
 * forever; every other subscription's delivery is independent (`Promise.allSettled`).
 */
export async function sendPush(db: Db, keys: PushKeys | null, category: PushCategory, payload: { title: string; body: string; path: string }): Promise<{ sent: number; skipped: number }> {
  const subs = listSubscriptions(db).filter((s) => s.categories.includes(category));
  if (!keys) {
    log.debug({ subscriptions: subs.length, title: payload.title }, 'web push not configured; skipping delivery');
    return { sent: 0, skipped: subs.length };
  }

  const message = JSON.stringify(payload);
  const options = { vapidDetails: { subject: VAPID_SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey } };
  const results = await Promise.allSettled(
    subs.map((s) => webPush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.keys['p256dh'] ?? '', auth: s.keys['auth'] ?? '' } }, message, options).then(() => s)),
  );

  let sent = 0;
  let skipped = 0;
  for (const [i, r] of results.entries()) {
    const sub = subs[i]!;
    if (r.status === 'fulfilled') { sent++; continue; }
    skipped++;
    const err = r.reason as unknown;
    if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
      deleteSubscription(db, sub.id);
      log.info({ subscriptionId: sub.id, statusCode: err.statusCode }, 'dropped a subscription the push service rejected as invalid');
    } else {
      log.warn({ err, subscriptionId: sub.id }, 'push delivery failed');
    }
  }
  return { sent, skipped };
}

export function pushRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** What the browser needs before `pushManager.subscribe` can succeed at all. */
  app.get(PUSH_ROUTES.config, (c) => {
    const vapidPublicKey = deps.daemon.push.vapidPublicKey ?? null;
    return c.json<PushConfig>({ configured: vapidPublicKey !== null, vapidPublicKey });
  });

  app.get(PUSH_ROUTES.subscriptions, (c) => c.json(listSubscriptions(c.get('ws').ctx.db).map((s) => ({ id: s.id, endpoint: s.endpoint, categories: s.categories, createdAt: s.createdAt }))));

  app.post(PUSH_ROUTES.subscriptions, async (c) => {
    const principal = c.get('principal');
    const sub = await body(c, z.object({ endpoint: z.string().url(), keys: z.record(z.string(), z.string()), categories: z.array(z.enum(PUSH_CATEGORIES)).optional() }));
    const db = c.get('ws').ctx.db;
    const id = newId();
    db.run('INSERT OR REPLACE INTO push_subscriptions (id, session_id, endpoint, keys_json, categories_json, created_at) VALUES (?,?,?,?,?,?)',
      [id, principal.kind === 'operator' ? principal.sessionId : 'local', sub.endpoint, JSON.stringify(sub.keys), JSON.stringify(sub.categories ?? DEFAULT_PUSH_CATEGORIES), nowIso()]);
    return c.json({ id }, 201);
  });

  app.delete(PUSH_ROUTES.subscription, (c) => {
    c.get('ws').ctx.db.run('DELETE FROM push_subscriptions WHERE id = ?', [c.req.param('id')]);
    return c.json({ ok: true });
  });

  return app;
}
