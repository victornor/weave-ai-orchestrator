/**
 * The changelog (PLAN §13.6): the human-facing record of what happened, read-only on purpose.
 *
 * There is no POST, PUT or DELETE here and there is no member on the service to call from one — the
 * record is append-only, and the only thing that appends to it is the path that caused the event.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types.js';

const limitParam = z.coerce.number().int().min(1).max(200).optional();

export function changelogRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => c.json(c.get('ws').services.changelog.list({
    projectId: c.req.query('project') ?? null,
    before: c.req.query('before') ?? null,
    ...(c.req.query('limit') !== undefined ? { limit: limitParam.parse(c.req.query('limit')) } : {}),
  })));

  app.get('/heatmap', (c) => c.json(c.get('ws').services.changelog.heatmap({
    projectId: c.req.query('project') ?? null,
    from: c.req.query('from') ?? null,
    to: c.req.query('to') ?? null,
    timezone: c.req.query('tz') ?? null,
  })));

  return app;
}
