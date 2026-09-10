/**
 * `GET /models` and `PUT /models` — the workspace's two model settings plus the worker-options
 * catalog (VS-77, ADR 0011; VS-162, ADR 0012; VS-185, ADR 0013).
 *
 * GET returns effective values (daemon overlay if filled) plus `locked`. PUT takes the two
 * settings whole. `workerOptions` omitted keeps the existing catalog; an explicit array
 * (including `[]`) replaces it. Locked controls are not written to workspace yaml.
 */
import { Hono } from 'hono';
import { WorkspaceModelsPutSchema } from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { body } from '../http.js';

export function modelRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => {
    const models = c.get('ws').services.models;
    return c.json({ ...models.get(), locked: models.locked() });
  });
  app.put('/', async (c) => {
    const models = c.get('ws').services.models;
    const next = await models.set(c.get('actor'), await body(c, WorkspaceModelsPutSchema));
    return c.json({ ...next, locked: models.locked() });
  });
  return app;
}
