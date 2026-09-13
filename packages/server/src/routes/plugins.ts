/**
 * `/api/w/:ws/plugins/:pluginId/*` (VS-334): a plugin's own HTTP routes, registered through
 * `PluginHost.registerHttpRoute`. Mounted like any other workspace route group (`app.ts`), so it
 * inherits the same session auth with no extra wiring — and, since it is not in `auth.ts`'s
 * `RUN_TOKEN_PATHS`, a run token never authenticates here at all; only a human session does.
 *
 * A plugin's own routes are matched dynamically against `ws.ctx.plugins.routes` (registered at
 * plugin load, not compiled in) rather than declared as static Hono routes, since the set of routes
 * is only known once a workspace's plugins have loaded.
 */
import { Hono } from 'hono';
import { OcError } from '@weave-ai/shared';
import type { PluginHttpMethod, PluginRequestCtx } from '@weave-ai/plugin-sdk';
import type { PluginRouteDef } from '@weave-ai/core';
import type { AppEnv } from '../types.js';
import { PLUGIN_PAGE_CSP } from '../plugin-page-csp.js';

/**
 * `/notes/:id` against `/notes/abc` -> `{ id: 'abc' }`; `null` when the shapes don't match — including
 * a segment whose `%` escape is malformed (plan review: `decodeURIComponent` throwing a `URIError`
 * must never escape this function as an uncaught exception; a request that cannot be decoded is
 * simply not a match, the same as any other path this pattern doesn't fit).
 */
export function matchPluginPath(pattern: string, actual: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const actualParts = actual.split('/').filter(Boolean);
  if (patternParts.length !== actualParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]!;
    const a = actualParts[i]!;
    if (p.startsWith(':')) {
      try { params[p.slice(1)] = decodeURIComponent(a); }
      catch { return null; }
    } else if (p !== a) return null;
  }
  return params;
}

export function findPluginRoute(routes: PluginRouteDef[], pluginId: string, method: string, path: string): { def: PluginRouteDef; params: Record<string, string> } | null {
  for (const def of routes) {
    if (def.pluginId !== pluginId || def.method !== method) continue;
    const params = matchPluginPath(def.path, path);
    if (params) return { def, params };
  }
  return null;
}

export function pluginRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.all('/:pluginId/*', async (c) => {
    const ws = c.get('ws');
    const pluginId = c.req.param('pluginId');
    const path = `/${c.req.path.split(`/plugins/${pluginId}/`)[1] ?? ''}`;
    const method = c.req.method as PluginHttpMethod;
    const match = findPluginRoute(ws.ctx.plugins.routes, pluginId, method, path);
    if (!match) throw new OcError('not_found', `no plugin route for ${method} ${path} on ${pluginId}`);
    const url = new URL(c.req.url);
    const req: PluginRequestCtx = {
      method, path, params: match.params, query: url.searchParams, headers: c.req.raw.headers,
      json: () => c.req.json(), text: () => c.req.text(), workspaceId: ws.id,
    };
    let res: Response;
    try {
      res = await match.def.handler(req);
    } catch (e) {
      const err = e instanceof OcError ? e : new OcError('internal', (e as Error).message ?? 'plugin route handler failed');
      return c.json({ error: { code: err.code, message: err.message } }, OcError.status(err.code) as never);
    }
    if ((res.headers.get('content-type') ?? '').includes('text/html')) {
      const headers = new Headers(res.headers);
      headers.set('content-security-policy', PLUGIN_PAGE_CSP);
      headers.set('x-content-type-options', 'nosniff');
      return new Response(res.body, { status: res.status, headers });
    }
    return res;
  });
  return app;
}
