/**
 * Web push endpoint paths, shared so the web app and the daemon cannot drift apart: the UI once
 * posted to `/push/subscribe`, which the daemon has never served, and the 404 read as "push is not
 * available". The daemon registers `PUSH_ROUTES` under `PUSH_BASE`; a client passes `pushPath`
 * to a workspace-scoped request.
 */

/** Where the push routes are mounted inside a workspace (`/api/w/:ws`). */
export const PUSH_BASE = '/push';

/** Paths relative to `PUSH_BASE` — what the daemon registers. */
export const PUSH_ROUTES = {
  config: '/config',
  subscriptions: '/subscriptions',
  subscription: '/subscriptions/:id',
} as const;

/** Workspace-relative paths — what a client asks for. */
export const pushPath = {
  config: `${PUSH_BASE}${PUSH_ROUTES.config}`,
  subscriptions: `${PUSH_BASE}${PUSH_ROUTES.subscriptions}`,
  subscription: (id: string): string => `${PUSH_BASE}${PUSH_ROUTES.subscriptions}/${encodeURIComponent(id)}`,
};

/**
 * What the browser needs before it can subscribe. `vapidPublicKey` is null until the daemon has
 * VAPID keys configured, and the web app says so instead of failing with a DOMException.
 */
export interface PushConfig {
  configured: boolean;
  vapidPublicKey: string | null;
}
