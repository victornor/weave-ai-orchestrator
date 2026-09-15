/**
 * Sign-in helpers. Two facts the router guard and the sign-in page share: where a sign-in may
 * return to, and whether the daemon refuses this browser as unauthenticated.
 *
 * "Refused" is deliberately narrow. A request the daemon answers 200 — including a trusted loopback
 * `/auth/me` with a null session and a null operator id, which `auth.loopbackTrusted` produces — is
 * signed in, and an unreachable daemon is not a sign-out. Only an HTTP 401 or an `auth_session_expired`
 * counts, so a local browser never loops to the sign-in (VS-353).
 */
import { ApiError, api } from '../api/client';

/** The `?next=` a sign-in may return to: a root path, never the sign-in itself. */
export function v2NextTarget(search?: string): string | null {
  const raw = search ?? (typeof window === 'undefined' ? '' : window.location.search);
  const value = new URLSearchParams(raw).get('next');
  if (!value) return null;
  let path = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      path = u.pathname + u.search;
    } catch {
      return null;
    }
  }
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/login') ? path : null;
}

/** Where a sign-in lands: the remembered target, else the first workspace, else onboarding. */
export function v2Landing(workspaceId: string | null): string {
  const next = v2NextTarget();
  if (next) return next;
  return workspaceId ? `/w/${encodeURIComponent(workspaceId)}/needs` : '/onboarding';
}

let cache: { at: number; promise: Promise<boolean> } | null = null;

/**
 * VS-411: once the daemon has answered 200 for this page load, the browser is signed in and no later
 * V2 navigation re-runs the probe. The route guard (`v2RootRoute.beforeLoad`) runs on every
 * navigation, and the router does not commit the new match until it resolves; with only the 5 s cache
 * a navigation more than 5 s after the last probe blocked on a fresh `GET /auth/me`, so the URL
 * changed and the body stayed on the previous screen until the daemon answered. A 401 from any API
 * call still sends the browser to sign-in through `api/client.ts`'s `onUnauthorized`.
 */
let signedIn = false;

/** Whether the daemon refuses this browser as unauthenticated (see the module note). */
export function v2Refused(): Promise<boolean> {
  if (signedIn) return Promise.resolve(false);
  const now = Date.now();
  if (!cache || now - cache.at >= 5_000) cache = { at: now, promise: probe() };
  const { promise } = cache;
  return promise.then((refused) => {
    if (!refused) signedIn = true;
    return refused;
  });
}

/** Clear the short-lived probe cache; tests call this between cases. */
export function resetV2RefusedCache(): void {
  cache = null;
  signedIn = false;
}

async function probe(): Promise<boolean> {
  try {
    await api.root('/auth/me', { timeoutMs: 8_000 });
    return false;
  } catch (e) {
    if (e instanceof ApiError) return e.status === 401 || e.code.toLowerCase().includes('expired');
    return false;
  }
}
