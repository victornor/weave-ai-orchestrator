/**
 * V2 sign-in helpers. Two facts the router guard and the sign-in page share: where a V2 sign-in may
 * return to, and whether the daemon refuses this browser as unauthenticated.
 *
 * "Refused" is deliberately narrow. A request the daemon answers 200 — including a trusted loopback
 * `/auth/me` with a null session and a null operator id, which `auth.loopbackTrusted` produces — is
 * signed in, and an unreachable daemon is not a sign-out. Only an HTTP 401 or an `auth_session_expired`
 * counts, so a local browser never loops to the sign-in (VS-353).
 */
import { ApiError, api } from '../api/client';

/** The `?next=` a V2 sign-in may return to: a `/v2` path, never the sign-in itself. */
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
  return path.startsWith('/v2/') && !path.startsWith('/v2/login') ? path : null;
}

/** Where a V2 sign-in lands: the remembered target, else the first workspace, else onboarding. */
export function v2Landing(workspaceId: string | null): string {
  const next = v2NextTarget();
  if (next) return next;
  return workspaceId ? `/v2/w/${encodeURIComponent(workspaceId)}/needs` : '/v2/onboarding';
}

let cache: { at: number; promise: Promise<boolean> } | null = null;

/** Whether the daemon refuses this browser as unauthenticated (see the module note). */
export function v2Refused(): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.at < 5_000) return cache.promise;
  const promise = probe();
  cache = { at: now, promise };
  return promise;
}

/** Clear the short-lived probe cache; tests call this between cases. */
export function resetV2RefusedCache(): void {
  cache = null;
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
