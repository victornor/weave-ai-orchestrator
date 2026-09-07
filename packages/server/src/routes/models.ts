/**
 * `GET /models` and `PUT /models` — the workspace's two model settings (VS-77, ADR 0011).
 *
 * `PUT` takes the whole block, as `PUT /presentation` does: it is parsed and stored entire, so a
 * partial body would drop the setting it did not mention rather than leaving it alone.
 */
import { Hono } from 'hono';
import { WorkspaceModelsSchema } from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { body } from '../http.js';

export function modelRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => c.json(c.get('ws').services.models.get()));
  app.put('/', async (c) => c.json(await c.get('ws').services.models.set(c.get('actor'), await body(c, WorkspaceModelsSchema))));
  return app;
}
