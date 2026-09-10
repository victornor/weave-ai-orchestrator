/**
 * `GET /models` and `PUT /models` — the workspace's two model settings plus the worker-options
 * catalog (VS-77, ADR 0011; VS-162, ADR 0012).
 *
 * `PUT` takes the two settings whole. `workerOptions` omitted keeps the existing catalog; an
 * explicit array (including `[]`) replaces it.
 */
import { Hono } from 'hono';
import { WorkspaceModelsPutSchema } from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { body } from '../http.js';

export function modelRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => c.json(c.get('ws').services.models.get()));
  app.put('/', async (c) => c.json(await c.get('ws').services.models.set(c.get('actor'), await body(c, WorkspaceModelsPutSchema))));
  return app;
}
