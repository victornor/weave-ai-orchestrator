/**
 * `/api/w/:ws/plugin-data/:pluginId` (VS-334): the operator-only purge of one plugin's stored data.
 * Deliberately a sibling of `/api/w/:ws/plugins/*`, not nested inside it — a plugin's own route
 * prefix is exactly what the page-to-host postMessage bridge (design.md Decision 5) is scoped to
 * proxy, so a route that must never be reachable from a plugin's own page has to live outside it.
 */
import { Hono } from 'hono';
import { PluginDataService } from '@weave-ai/core';
import type { AppEnv } from '../types.js';
import { requireOperator } from '../auth.js';

export function pluginDataRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.delete('/:pluginId', (c) => {
    requireOperator(c);
    const ws = c.get('ws');
    const pluginId = c.req.param('pluginId');
    const removed = new PluginDataService(ws.ctx.db).purge(pluginId);
    return c.json({ pluginId, removed });
  });
  return app;
}
