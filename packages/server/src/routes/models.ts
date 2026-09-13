/**
 * `GET /models` and `PUT /models` — the workspace's two model settings plus the worker-options
 * catalog (VS-77, ADR 0011; VS-162, ADR 0012; VS-185, ADR 0013; VS-284; VS-356).
 *
 * GET returns effective values — the workspace's own configured setting when it has one, otherwise
 * a filled daemon overlay, otherwise the schema default — plus an additive per-control `source`
 * (`'workspace' | 'daemon' | 'default'`) so a client can tell inherit from a pinned equal value.
 * PUT changes only the controls it names: a value overrides, `null` clears back to inherit, omission
 * keeps the stored value; `workerOptions` `null`/`[]` clears the catalog. Its response is the same
 * sourced view as GET.
 */
import { Hono } from 'hono';
import { WorkspaceModelsPutSchema } from '@weave-ai/shared';
import type { AppEnv } from '../types.js';
import { body } from '../http.js';

export function modelRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => {
    const models = c.get('ws').services.models;
    return c.json(models.get());
  });
  app.put('/', async (c) => {
    const models = c.get('ws').services.models;
    const next = await models.set(c.get('actor'), await body(c, WorkspaceModelsPutSchema));
    return c.json(next);
  });
  return app;
}
