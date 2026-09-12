/**
 * Turning web push on and off for this device.
 *
 * The paths come from `@weave-ai/shared`, the same constants the daemon registers its push
 * routes with, so the two cannot drift apart again — the web app used to post a subscription to
 * `/push/subscribe`, a route the daemon has never served, and the 404 was swallowed into "push is
 * not available". Every failure here keeps its message so the toggle can say what actually broke.
 *
 * The subscription id the daemon hands back is kept per workspace in `localStorage`: it is what a
 * later DELETE needs, and it is per device by nature, so it belongs beside the browser's own
 * subscription rather than in the workspace database.
 */
import { pushPath, DEFAULT_PUSH_CATEGORIES, type PushCategory, type PushConfig } from '@weave-ai/shared';
import { api } from '../api/client';

const PREFIX = 'conductor.push';

function idKey(ws: string): string {
  return `${PREFIX}.${ws}`;
}

/** The id of this device's subscription in that workspace, if it registered one. */
export function subscriptionId(ws: string): string | null {
  try {
    return localStorage.getItem(idKey(ws));
  } catch {
    return null;
  }
}

function remember(ws: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(idKey(ws), id);
    else localStorage.removeItem(idKey(ws));
  } catch {
    /* private mode */
  }
}

/** A VAPID key travels as URL-safe base64; `subscribe` wants the bytes. */
export function decodeVapidKey(key: string): Uint8Array<ArrayBuffer> {
  const padded = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function supported(): boolean {
  return typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

/**
 * Ask for permission, read the daemon's push config, subscribe and register the subscription with
 * `categories` (the caller's current toggle state — defaulting to Settings' own defaults so a
 * subscription made before the toggles are ever touched still gets what they promise).
 * Throws with a message worth showing: nothing here is caught and turned into a generic failure.
 */
export async function enablePush(ws: string, categories: PushCategory[] = DEFAULT_PUSH_CATEGORIES): Promise<void> {
  if (!supported()) throw new Error('This browser cannot receive push notifications.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site — allow them in the browser and try again.');

  const config = await api.ws<PushConfig>(ws, pushPath.config);
  if (!config.configured || !config.vapidPublicKey) {
    throw new Error('Push is not configured on the daemon: no VAPID key. Set `push.vapidPublicKey` in the daemon config.');
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(config.vapidPublicKey) }));

  const { id } = await api.ws<{ id: string }>(ws, pushPath.subscriptions, { method: 'POST', body: { ...subscription.toJSON(), categories } });
  remember(ws, id);
}

/**
 * Re-registers this device's existing browser subscription with a new category selection — no
 * unsubscribe/resubscribe round trip, since `POST /push/subscriptions` is an upsert keyed on the
 * endpoint. A no-op if this device is not currently subscribed.
 */
export async function updatePushCategories(ws: string, categories: PushCategory[]): Promise<void> {
  if (!supported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const { id } = await api.ws<{ id: string }>(ws, pushPath.subscriptions, { method: 'POST', body: { ...subscription.toJSON(), categories } });
  remember(ws, id);
}

/** Drop the browser subscription and the daemon's record of it. */
export async function disablePush(ws: string): Promise<void> {
  if (supported()) {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  }
  const id = subscriptionId(ws);
  if (id) await api.ws(ws, pushPath.subscription(id), { method: 'DELETE' });
  remember(ws, null);
}
