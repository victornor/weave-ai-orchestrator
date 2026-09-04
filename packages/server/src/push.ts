/**
 * Web push subscriptions for the PWA (§4.4). Storage is real; delivery is a documented stub —
 * VAPID keys and a sender are M6 work, so `send` logs and reports `skipped`.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { newId, nowIso, type Db } from '@openconductor/db';
import { getLogger } from '@openconductor/core';
import type { AppEnv } from './types.js';
import { body } from './http.js';

const log = getLogger('http', { component: 'push' });

export interface PushSubscriptionRow { id: string; sessionId: string; endpoint: string; keys: Record<string, string>; createdAt: string }

export function listSubscriptions(db: Db): PushSubscriptionRow[] {
  return db.all<PushSubscriptionRow>('SELECT id, session_id, endpoint, keys_json, created_at FROM push_subscriptions ORDER BY created_at');
}

/** No sender is configured in v1; kept as one call site so wiring web-push later is a one-file change. */
export async function sendPush(db: Db, payload: { title: string; body: string; url?: string }): Promise<{ sent: number; skipped: number }> {
  const subs = listSubscriptions(db);
  log.debug({ subscriptions: subs.length, title: payload.title }, 'web push not configured; skipping delivery');
  return { sent: 0, skipped: subs.length };
}

export function pushRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/subscriptions', (c) => c.json(listSubscriptions(c.get('ws').ctx.db).map((s) => ({ id: s.id, endpoint: s.endpoint, createdAt: s.createdAt }))));

  app.post('/subscriptions', async (c) => {
    const principal = c.get('principal');
    const sub = await body(c, z.object({ endpoint: z.string().url(), keys: z.record(z.string(), z.string()) }));
    const db = c.get('ws').ctx.db;
    const id = newId();
    db.run('INSERT OR REPLACE INTO push_subscriptions (id, session_id, endpoint, keys_json, created_at) VALUES (?,?,?,?,?)',
      [id, principal.kind === 'operator' ? principal.sessionId : 'local', sub.endpoint, JSON.stringify(sub.keys), nowIso()]);
    return c.json({ id }, 201);
  });

  app.delete('/subscriptions/:id', (c) => {
    c.get('ws').ctx.db.run('DELETE FROM push_subscriptions WHERE id = ?', [c.req.param('id')]);
    return c.json({ ok: true });
  });

  return app;
}
