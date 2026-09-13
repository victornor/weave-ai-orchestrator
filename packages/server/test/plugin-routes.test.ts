/**
 * VS-334: `/api/w/:ws/plugins/:pluginId/*` mounting, auth, and the page CSP; the operator-only
 * `/api/w/:ws/plugin-data/:pluginId` purge route sitting outside that prefix. Uses the fakes.ts
 * harness and pushes route defs directly onto `ctx.plugins.routes` — the same shape `loadPlugins`
 * would populate from a real plugin's `registerHttpRoute` calls, without needing a module on disk.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { PluginDataService } from '@weave-ai/core';
import { ARTIFACT_CSP } from '../src/artifact-csp.js';
import { PLUGIN_PAGE_CSP } from '../src/plugin-page-csp.js';
import { findPluginRoute, matchPluginPath } from '../src/routes/plugins.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const app = (opts?: Parameters<typeof makeHarness>[0]) => {
  harness = makeHarness(opts);
  return { h: harness, fetch: (path: string, init?: RequestInit) => createApp(harness!.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
};

describe('matchPluginPath / findPluginRoute (VS-334)', () => {
  it('matches an exact path with no params', () => {
    expect(matchPluginPath('/notes', '/notes')).toEqual({});
  });
  it('matches a :param segment', () => {
    expect(matchPluginPath('/notes/:id', '/notes/abc')).toEqual({ id: 'abc' });
  });
  it('does not match a different segment count', () => {
    expect(matchPluginPath('/notes/:id', '/notes/abc/extra')).toBeNull();
  });
  it('treats a malformed %-escape as a non-match rather than throwing (plan review)', () => {
    expect(() => matchPluginPath('/notes/:id', '/notes/%E0%A4%A')).not.toThrow();
    expect(matchPluginPath('/notes/:id', '/notes/%E0%A4%A')).toBeNull();
  });
  it('finds a route by pluginId, method, and path together', () => {
    const routes = [
      { pluginId: 'a', method: 'GET' as const, path: '/x', handler: () => new Response('a') },
      { pluginId: 'b', method: 'GET' as const, path: '/x', handler: () => new Response('b') },
    ];
    expect(findPluginRoute(routes, 'b', 'GET', '/x')?.def.pluginId).toBe('b');
    expect(findPluginRoute(routes, 'a', 'POST', '/x')).toBeNull();
  });
});

describe('plugin HTTP routes (VS-334)', () => {
  it('a registered route responds only with a valid session, and only under its own plugin id', async () => {
    const { h, fetch } = app();
    h.runtime.ctx.plugins.routes.push({ pluginId: 'demo', method: 'GET', path: '/hello', handler: () => Response.json({ hi: true }) });

    const unauth = await fetch('/api/w/ws1/plugins/demo/hello');
    expect(unauth.status).toBe(401);

    const ok = await fetch('/api/w/ws1/plugins/demo/hello', { headers: authed() });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ hi: true });

    const wrongPlugin = await fetch('/api/w/ws1/plugins/someone-else/hello', { headers: authed() });
    expect(wrongPlugin.status).toBe(404);
  });

  it('a malformed %-escape in a param segment 404s rather than 500ing (plan review)', async () => {
    const { h, fetch } = app();
    h.runtime.ctx.plugins.routes.push({ pluginId: 'demo', method: 'GET', path: '/notes/:id', handler: () => Response.json({ ok: true }) });
    const res = await fetch('/api/w/ws1/plugins/demo/notes/%E0%A4%A', { headers: authed() });
    expect(res.status).toBe(404);
  });

  it('a throwing handler returns an error response without affecting a later request', async () => {
    const { h, fetch } = app();
    h.runtime.ctx.plugins.routes.push({
      pluginId: 'demo', method: 'GET', path: '/boom',
      handler: () => { throw new Error('kaboom'); },
    });
    h.runtime.ctx.plugins.routes.push({ pluginId: 'demo', method: 'GET', path: '/fine', handler: () => Response.json({ ok: true }) });

    const bad = await fetch('/api/w/ws1/plugins/demo/boom', { headers: authed() });
    expect(bad.status).toBeGreaterThanOrEqual(500);

    const fine = await fetch('/api/w/ws1/plugins/demo/fine', { headers: authed() });
    expect(fine.status).toBe(200);
  });

  it('an HTML response from a plugin route carries the plugin page CSP, not the artifact one', async () => {
    const { h, fetch } = app();
    h.runtime.ctx.plugins.routes.push({
      pluginId: 'demo', method: 'GET', path: '/page',
      handler: () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
    });
    const res = await fetch('/api/w/ws1/plugins/demo/page', { headers: authed() });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(PLUGIN_PAGE_CSP);
    expect(res.headers.get('content-security-policy')).not.toBe(ARTIFACT_CSP);
  });

  it("the plugin page CSP blocks form submission to any target (plan review): allow-forms plus no form-action would let a page's form escape the sandbox", async () => {
    const { h, fetch } = app();
    h.runtime.ctx.plugins.routes.push({
      pluginId: 'demo', method: 'GET', path: '/page',
      handler: () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
    });
    const res = await fetch('/api/w/ws1/plugins/demo/page', { headers: authed() });
    expect(res.headers.get('content-security-policy')).toContain("form-action 'none'");
  });
});

describe('workspace summary plugins field (VS-334)', () => {
  it('lists a loaded and a failed plugin, each with id, version, source, loaded, error, hasPage', async () => {
    const { h, fetch } = app();
    h.runtime.ctx.plugins.loaded.push(
      { id: 'notes', version: '0.1.0', source: 'workspace', loaded: true, error: null, hasPage: true },
      { id: 'broken', version: null, source: 'daemon', loaded: false, error: 'boom', hasPage: false },
    );
    const res = await fetch('/api/w/ws1', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plugins).toEqual([
      { id: 'notes', version: '0.1.0', source: 'workspace', loaded: true, error: null, hasPage: true },
      { id: 'broken', version: null, source: 'daemon', loaded: false, error: 'boom', hasPage: false },
    ]);
  });
});

describe('plugin data purge route (VS-334)', () => {
  it('is operator-only, sits outside /plugins/:pluginId, and removes only the named plugin\'s rows', async () => {
    const { h, fetch } = app();
    const store = new PluginDataService(h.db);
    store.put('demo', 'k1', { v: 1 });
    store.put('other', 'k1', { v: 2 });

    const unauth = await fetch('/api/w/ws1/plugin-data/demo', { method: 'DELETE' });
    expect(unauth.status).toBe(401);
    expect(store.get('demo', 'k1')).not.toBeNull();

    // Structurally not under the plugin's own route prefix — the plugin route matcher never sees it.
    const notUnderPlugins = await fetch('/api/w/ws1/plugins/demo/data', { headers: authed() });
    expect(notUnderPlugins.status).toBe(404);

    const res = await fetch('/api/w/ws1/plugin-data/demo', { method: 'DELETE', headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pluginId: 'demo', removed: 1 });
    expect(store.get('demo', 'k1')).toBeNull();
    expect(store.get('other', 'k1')).toEqual({ v: 2 });
  });
});
