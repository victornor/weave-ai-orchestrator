import { Hono } from 'hono';
import { z } from 'zod';
import { OcError, ProjectConfigSchema, ProjectPoliciesSchema } from '@weave-ai/shared';
import type { AppEnv } from '../types.js';
import { body } from '../http.js';

const AddSchema = z.object({
  url: z.string().min(1), id: z.string().optional(), name: z.string().optional(),
  defaultBranch: z.string().optional(), landingBranch: z.string().optional(), maxWorkers: z.number().int().min(1).max(32).optional(), setupCommand: z.string().optional(),
  policies: ProjectPoliciesSchema.optional(),
// Strict: a project carries no runtime or model since VS-77, and a body that still sends one is a
// caller that would otherwise believe it had chosen something. Ticket-level autoMerge is not a
// project field — Auto-merge default is policies.autoMergeDefault (VS-153).
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
  /** Read-only (VS-131): classifies the clone against its remote without checkout or merge. */
  app.get('/:id/sync', async (c) => c.json(await c.get('ws').services.projects.checkSync(c.req.param('id'))));
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
    const number = prNumber(c.req.param('number'));
    return c.json(await c.get('ws').services.pullRequests.get(c.req.param('id'), number));
  });
  /**
   * The pull request's diff, per file (VS-107): a manifest with no hunks, and one file's hunks sliced
   * from the same parse — so opening a pull request, and opening one file of it, are each their own
   * cheap request. Both share the pull-requests cache's TTL and event-driven invalidation.
   */
  app.get('/:id/pull-requests/:number/diff', async (c) => {
    const number = prNumber(c.req.param('number'));
    return c.json(await c.get('ws').services.pullRequests.diffFiles(c.req.param('id'), number));
  });
  app.get('/:id/pull-requests/:number/diff/file', async (c) => {
    const number = prNumber(c.req.param('number'));
    const path = c.req.query('path');
    if (!path) throw new OcError('validation', 'path is required', {});
    return c.json(await c.get('ws').services.pullRequests.diffFile(c.req.param('id'), number, path));
  });
  /** Expands a collapsed unchanged region from the base revision's own content (design.md). */
  app.get('/:id/pull-requests/:number/diff/file/context', async (c) => {
    const number = prNumber(c.req.param('number'));
    const path = c.req.query('path');
    if (!path) throw new OcError('validation', 'path is required', {});
    const start = Number(c.req.query('start'));
    const end = Number(c.req.query('end'));
    if (!Number.isInteger(start) || start <= 0) throw new OcError('validation', 'start must be a positive integer', { start: c.req.query('start') });
    if (!Number.isInteger(end) || end <= 0) throw new OcError('validation', 'end must be a positive integer', { end: c.req.query('end') });
    return c.json(await c.get('ws').services.pullRequests.diffContext(c.req.param('id'), number, path, start, end));
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

function prNumber(raw: string): number {
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) throw new OcError('validation', 'pull request number must be a positive integer', { number: raw });
  return number;
}

function slugFromUrl(url: string): string {
  const tail = url.replace(/\.git$/, '').split(/[/:]/).pop() ?? 'project';
  return tail.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'project';
}
