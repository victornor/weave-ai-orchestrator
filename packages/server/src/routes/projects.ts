import { Hono } from 'hono';
import { z } from 'zod';
import { OcError, ProjectConfigSchema } from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { body } from '../http.js';

const AddSchema = z.object({
  url: z.string().min(1), id: z.string().optional(), name: z.string().optional(),
  defaultBranch: z.string().optional(), maxWorkers: z.number().int().min(1).max(32).optional(), setupCommand: z.string().optional(),
// Strict: a project carries no runtime or model since VS-77, and a body that still sends one is a
// caller that would otherwise believe it had chosen something.
}).strict();

export function projectRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => c.json(c.get('ws').services.projects.list()));
  app.get('/:id', (c) => c.json(c.get('ws').services.projects.get(c.req.param('id'))));
  /**
   * 202, not 201: the clone, the OpenSpec adoption and the knowledge seed take minutes, and progress
   * cannot be watched from inside the request producing it. The row exists when this answers; the job
   * reports the rest (VS-37).
   */
  app.post('/', async (c) => {
    const input = await body(c, AddSchema);
    const cfg = ProjectConfigSchema.parse({ ...input, id: input.id ?? slugFromUrl(input.url) });
    return c.json(c.get('ws').services.projects.startAdd(c.get('actor'), cfg), 202);
  });
  /** Re-run a failed add against whatever is already on disk. */
  app.post('/:id/retry', (c) => c.json(c.get('ws').services.projects.retryAdd(c.get('actor'), c.req.param('id')), 202));
  app.patch('/:id', async (c) => c.json(await c.get('ws').services.projects.update(c.get('actor'), c.req.param('id'), await body(c, ProjectConfigSchema.partial().strict()))));
  app.delete('/:id', async (c) => { await c.get('ws').services.projects.remove(c.get('actor'), c.req.param('id')); return c.json({ ok: true }); });
  app.post('/:id/fetch', async (c) => c.json(await c.get('ws').services.projects.fetch(c.req.param('id'))));
  // The project's merge queue: what is landing now and who is waiting, in order (PLAN §11.4).
  app.get('/:id/merge-queue', (c) => {
    const s = c.get('ws').services;
    return c.json(s.tickets.mergeQueue.forProject(s.projects.get(c.req.param('id')).id));
  });
  /**
   * The project's pull requests, joined to their tickets, spec changes and queue place (VS-97).
   * Read-only, and never an error status for a project that simply has no forge: the answer carries
   * `available: false` with the reason, because a section cannot tell that from a failed request out
   * of an HTTP code.
   */
  app.get('/:id/pull-requests', async (c) => c.json(await c.get('ws').services.pullRequests.list(c.req.param('id'))));
  app.get('/:id/pull-requests/:number', async (c) => {
    const number = Number(c.req.param('number'));
    if (!Number.isInteger(number) || number <= 0) throw new OcError('validation', 'pull request number must be a positive integer', { number: c.req.param('number') });
    return c.json(await c.get('ws').services.pullRequests.get(c.req.param('id'), number));
  });
  /**
   * The project's commit graph (VS-96): the default branch plus every live worker/ticket branch,
   * paged. `:commits` sits above the `:id/commits/:sha` route only in that both are registered here
   * together; neither collides with `/:id` because both carry a literal segment after the project id.
   */
  app.get('/:id/history', async (c) => {
    const limitRaw = c.req.query('limit');
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) throw new OcError('validation', 'limit must be a positive integer', { limit: limitRaw });
    return c.json(await c.get('ws').services.projects.history(c.req.param('id'), { cursor: c.req.query('cursor') ?? null, limit }));
  });
  app.get('/:id/commits/:sha', async (c) => c.json(await c.get('ws').services.projects.commit(c.req.param('id'), c.req.param('sha'))));
  return app;
}

function slugFromUrl(url: string): string {
  const tail = url.replace(/\.git$/, '').split(/[/:]/).pop() ?? 'project';
  return tail.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'project';
}
