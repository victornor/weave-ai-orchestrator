/**
 * Scheduled tasks (`routines`): recurring conductor alarms (VS-220).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { ROUTINE_ACTIONS, ROUTINE_STATUSES, ROUTINE_USAGE_WINDOWS } from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { body, query } from '../http.js';

const TriggerSchema = z.object({
  kind: z.literal('schedule').optional(),
  timezone: z.string().optional(),
  daily: z.object({ hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).optional(),
  everyMinutes: z.number().int().optional(),
  cron: z.string().optional(),
}).passthrough();

const CreateSchema = z.object({
  name: z.string().min(1),
  trigger: TriggerSchema,
  instruction: z.string().min(1),
  action: z.enum(ROUTINE_ACTIONS).optional(),
  maxTicketsPerFire: z.number().int().optional(),
  projectId: z.string().nullish(),
});

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
  trigger: TriggerSchema.optional(),
  instruction: z.string().min(1).optional(),
  action: z.enum(ROUTINE_ACTIONS).optional(),
  maxTicketsPerFire: z.number().int().optional(),
  projectId: z.string().nullish(),
  status: z.enum(ROUTINE_STATUSES).optional(),
});

export function routineRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => c.json({ items: c.get('ws').services.routines.list() }));

  app.post('/', async (c) => c.json(c.get('ws').services.routines.create(c.get('actor'), await body(c, CreateSchema)), 201));

  app.get('/:id/usage', (c) => {
    const q = query(c, z.object({ window: z.enum(ROUTINE_USAGE_WINDOWS).default('7d') }));
    return c.json(c.get('ws').services.routines.usage(c.req.param('id'), q.window));
  });

  app.get('/:id/fires', (c) => c.json({ items: c.get('ws').services.routines.fires(c.req.param('id')) }));

  app.get('/:id', (c) => c.json(c.get('ws').services.routines.get(c.req.param('id'))));

  app.patch('/:id', async (c) => c.json(c.get('ws').services.routines.update(c.get('actor'), c.req.param('id'), await body(c, PatchSchema))));

  app.delete('/:id', (c) => {
    c.get('ws').services.routines.remove(c.get('actor'), c.req.param('id'));
    return c.json({ ok: true });
  });

  return app;
}
