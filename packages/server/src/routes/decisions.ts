import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types.js';
import { body, csv, query } from '../http.js';

export function decisionRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => {
    const q = query(c, z.object({ status: csv.optional(), owner: z.enum(['human', 'conductor']).optional(), ticket: z.string().optional(), limit: z.coerce.number().int().optional() }));
    return c.json(c.get('ws').services.decisions.list({ status: q.status as never, owner: q.owner, ticketId: q.ticket, limit: q.limit }));
  });
  app.get('/:id', (c) => c.json(c.get('ws').services.decisions.get(c.req.param('id'))));
  // `inputs` may carry the value of a `secret` input, so nothing on this path logs the body: the
  // service registers the value and records only the name it was stored under (VS-92).
  app.post('/:id/answer', async (c) => {
    const answer = await body(c, z.object({
      key: z.string().optional(), text: z.string().optional(), remember: z.boolean().optional(),
      inputs: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    }));
    return c.json(await c.get('ws').services.decisions.answer(c.get('actor'), c.req.param('id'), answer));
  });
  app.post('/:id/withdraw', async (c) => {
    const { reason } = await body(c, z.object({ reason: z.string().default('withdrawn by operator') }));
    return c.json(c.get('ws').services.decisions.withdraw(c.get('actor'), c.req.param('id'), reason));
  });
  return app;
}
