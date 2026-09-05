import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types.js';
import { body, query } from '../http.js';

export function threadRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => c.json(c.get('ws').services.threads.list({ channelKind: c.req.query('channel') })));

  app.post('/', async (c) => {
    const i = await body(c, z.object({ channel: z.string().default('web'), label: z.string().optional() }));
    const externalThreadId = `web:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return c.json(c.get('ws').services.threads.bindOrGet(i.channel, externalThreadId, null, i.label), 201);
  });

  app.get('/:id/messages', (c) => {
    const q = query(c, z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }));
    return c.json(c.get('ws').services.threads.messages(c.req.param('id'), q));
  });

  app.post('/:id/messages', async (c) => {
    const { body: text, projectId, replyToMessageId } = await body(c, z.object({ body: z.string().min(1), projectId: z.string().nullish(), replyToMessageId: z.string().nullish() }));
    return c.json(await c.get('ws').services.threads.inbound(c.get('actor'), c.req.param('id'), text, { projectId, replyToMessageId }), 201);
  });

  app.post('/:id/bind', async (c) => {
    const { ticketId } = await body(c, z.object({ ticketId: z.string().nullable() }));
    return c.json(c.get('ws').services.threads.bindTicket(c.get('actor'), c.req.param('id'), ticketId));
  });

  return app;
}
