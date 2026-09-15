/**
 * Sign-in helpers (VS-353, VS-456): the return target is a root path, and "signed out" means the
 * daemon refused the request — a 200 with a null session (trusted loopback) is signed in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { v2NextTarget, v2Refused, resetV2RefusedCache } = await import('../v2/auth');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('the return target', () => {
  it('accepts a root path from ?next', () => {
    window.history.replaceState({}, '', '/login?next=' + encodeURIComponent('/w/acme/work'));
    expect(v2NextTarget()).toBe('/w/acme/work');
  });

  it('ignores a next that is not a root path', () => {
    window.history.replaceState({}, '', '/login?next=' + encodeURIComponent('w/acme/work'));
    expect(v2NextTarget()).toBeNull();
    window.history.replaceState({}, '', '/login?next=' + encodeURIComponent('//evil.example/w/acme'));
    expect(v2NextTarget()).toBeNull();
  });

  it('does not return to the sign-in itself', () => {
    window.history.replaceState({}, '', '/login?next=' + encodeURIComponent('/login'));
    expect(v2NextTarget()).toBeNull();
  });

  it('accepts an absolute same-origin link and keeps the path', () => {
    window.history.replaceState({}, '', '/login?next=' + encodeURIComponent('http://localhost/w/acme/work?x=1'));
    expect(v2NextTarget()).toBe('/w/acme/work?x=1');
  });
});

describe('whether the daemon refuses the browser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetV2RefusedCache();
  });

  it('is not signed out on a 200, even with a null session (trusted loopback)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ operator: { configured: true, id: null }, session: null, totpEnabled: false }));
    await expect(v2Refused()).resolves.toBe(false);
  });

  it('is signed out on a 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: 'auth required' } }, 401));
    await expect(v2Refused()).resolves.toBe(true);
  });

  it('is signed out on an expired session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { code: 'auth_session_expired', message: 'expired' } }, 401));
    await expect(v2Refused()).resolves.toBe(true);
  });

  it('is not signed out when the daemon cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(v2Refused()).resolves.toBe(false);
  });

  it('re-probes after the cache is reset, so a fresh sign-in is not bounced back', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'unauthorized', message: 'no' } }, 401))
      .mockResolvedValue(jsonResponse({ operator: { configured: true, id: 'op' }, session: { id: 's' }, totpEnabled: false }));
    await expect(v2Refused()).resolves.toBe(true); // refused and cached by the guard
    resetV2RefusedCache(); // what V2Login does after setToken
    await expect(v2Refused()).resolves.toBe(false); // the landing guard now sees the session
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not re-probe a later navigation once the daemon has answered signed-in (VS-411)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ operator: { configured: true, id: 'op' }, session: { id: 's' }, totpEnabled: false }));
    const now = Date.now();
    await expect(v2Refused()).resolves.toBe(false);
    // Past the 5 s cache: without the sticky signed-in result, a navigation more than 5 s after the
    // last probe blocks on a fresh GET /auth/me, so the URL changes and the body stays put.
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    await expect(v2Refused()).resolves.toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('the 401 redirect', () => {
  const original = window.location;

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
    vi.restoreAllMocks();
  });

  it('sends a 401 to /login and remembers where', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/w/acme/work', search: '?x=1', host: 'localhost', assign } });
    const { api } = await import('../api/client');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: 'no' } }, 401));
    await api.root('/x').catch(() => undefined);
    expect(assign).toHaveBeenCalledWith('/login?next=' + encodeURIComponent('/w/acme/work?x=1'));
  });
});
