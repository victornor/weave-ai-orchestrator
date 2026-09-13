/**
 * V2 sign-in helpers (VS-353): the return target is version-scoped, and "signed out" means the
 * daemon refused the request — a 200 with a null session (trusted loopback) is signed in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { v2NextTarget, v2Refused, resetV2RefusedCache } = await import('../v2/auth');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('the V2 return target', () => {
  it('accepts a /v2 path from ?next', () => {
    window.history.replaceState({}, '', '/v2/login?next=' + encodeURIComponent('/v2/w/acme/work'));
    expect(v2NextTarget()).toBe('/v2/w/acme/work');
  });

  it('ignores a next that is not a /v2 path', () => {
    window.history.replaceState({}, '', '/v2/login?next=' + encodeURIComponent('/w/acme/work'));
    expect(v2NextTarget()).toBeNull();
  });

  it('does not return to the sign-in itself', () => {
    window.history.replaceState({}, '', '/v2/login?next=' + encodeURIComponent('/v2/login'));
    expect(v2NextTarget()).toBeNull();
  });

  it('accepts an absolute same-origin link and keeps the path', () => {
    window.history.replaceState({}, '', '/v2/login?next=' + encodeURIComponent('http://localhost/v2/w/acme/work?x=1'));
    expect(v2NextTarget()).toBe('/v2/w/acme/work?x=1');
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
});

describe('the 401 redirect is V2-aware', () => {
  const original = window.location;

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
    vi.restoreAllMocks();
  });

  it('sends a /v2 request to /v2/login and remembers where', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/v2/w/acme/work', search: '?x=1', host: 'localhost', assign } });
    const { api } = await import('../api/client');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: 'no' } }, 401));
    await api.root('/x').catch(() => undefined);
    expect(assign).toHaveBeenCalledWith('/v2/login?next=' + encodeURIComponent('/v2/w/acme/work?x=1'));
  });

  it('leaves a V1 request on /login', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/w/acme/work', search: '', host: 'localhost', assign } });
    const { api } = await import('../api/client');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: 'no' } }, 401));
    await api.root('/x').catch(() => undefined);
    expect(assign).toHaveBeenCalledWith('/login?next=' + encodeURIComponent('/w/acme/work'));
  });
});
