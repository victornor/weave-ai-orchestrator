import { Hono } from 'hono';
import { z } from 'zod';
import { TICKET_KINDS, TICKET_PRIORITIES, TICKET_STATUSES, OcError } from '@weave-ai/shared';
import type { AppEnv } from '../types.js';
import { body, csv, query } from '../http.js';
import { requireOperator } from '../auth.js';

/**
 * VS-269: an artifact is served in an opaque, sandboxed origin so agent-authored HTML can never read
 * the `ac_session` cookie or call back into the API — not negotiable, per captain's specification.
 */
const ARTIFACT_CSP = "sandbox allow-scripts allow-forms allow-popups allow-downloads; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src data: 'self'; font-src data:; connect-src 'none'";

const CreateSchema = z.object({
  projectId: z.string().nullish(), kind: z.enum(TICKET_KINDS), title: z.string().min(1), description: z.string().default(''),
  summary: z.string().max(200).nullish(),
  priority: z.enum(TICKET_PRIORITIES).default('medium'), parentId: z.string().nullish(), blockedBy: z.array(z.string()).optional(),
  assigneeRoleId: z.string().nullish(), autoMerge: z.boolean().optional(), originKind: z.string().optional(), originFingerprint: z.string().optional(),
  // Set only at creation (VS-119); never inferred from a PR base, and not on PatchSchema below.
  landingBranch: z.string().nullish(),
  workerModelId: z.string().nullish(),
});
const PatchSchema = z.object({
  title: z.string().min(1).optional(), description: z.string().optional(), summary: z.string().max(200).nullish(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  autoMerge: z.boolean().optional(), parentId: z.string().nullish(), projectId: z.string().nullish(),
});
const TransitionSchema = z.object({
  to: z.enum(TICKET_STATUSES), note: z.string().optional(),
  unblock: z.object({ owner: z.enum(['weaver', 'human']), action: z.string().min(1) }).optional(),
  blockedBy: z.array(z.string()).optional(),
});
const ListQuery = z.object({
  project: z.string().optional(), status: csv.optional(), kind: csv.optional(), role: z.string().optional(),
  search: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).optional(), offset: z.coerce.number().int().min(0).optional(),
  includeTerminal: z.string().optional(), sort: z.enum(['number', 'finished']).optional(),
  fields: z.enum(['label']).optional(),
});

export function ticketRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const q = query(c, ListQuery);
    return c.json(c.get('ws').services.tickets.list({
      projectId: q.project, status: q.status as never, kind: q.kind as never, roleId: q.role,
      search: q.search, limit: q.limit, offset: q.offset, includeTerminal: q.includeTerminal === 'true', sort: q.sort,
      fields: q.fields,
    }));
  });

  app.post('/', async (c) => c.json(c.get('ws').services.tickets.create(c.get('actor'), await body(c, CreateSchema)), 201));

  app.get('/:id', async (c) => {
    const s = c.get('ws').services;
    const ticket = s.tickets.get(c.req.param('id'));
    const openspecState = await s.openspec.statusFor(ticket.id).catch(() => null);
    return c.json({
      ticket,
      blockers: s.tickets.blockers(ticket.id),
      children: s.tickets.children(ticket.id),
      worker: (() => {
        const workerId = ticket.workerId ?? s.tickets.lastWorker(ticket.id)?.id ?? null;
        return workerId ? safe(() => s.workers.get(workerId)) : null;
      })(),
      openspecState,
      workProducts: s.tickets.workProducts(ticket.id),
      // Where this ticket stands in its project's merge queue: null once it is merging or elsewhere.
      mergeQueue: { position: s.tickets.mergeQueue.positionOf(ticket.id), concurrency: s.tickets.mergeQueue.limitFor(ticket.projectId) },
      documents: s.tickets.documents(ticket.id),
    });
  });

  app.patch('/:id', async (c) => c.json(c.get('ws').services.tickets.update(c.get('actor'), c.req.param('id'), await body(c, PatchSchema))));

  app.post('/:id/assign', async (c) => {
    const { roleId, workerModelId } = await body(c, z.object({ roleId: z.string().nullable(), workerModelId: z.string().nullish() }));
    return c.json(c.get('ws').services.tickets.assign(c.get('actor'), c.req.param('id'), roleId, workerModelId));
  });

  app.post('/:id/transition', async (c) => c.json(await c.get('ws').services.tickets.transition(c.get('actor'), c.req.param('id'), await body(c, TransitionSchema))));

  app.post('/:id/retry', async (c) => {
    const { note } = await body(c, z.object({ note: z.string().optional() }));
    return c.json(await c.get('ws').services.tickets.retry(c.get('actor'), c.req.param('id'), note));
  });
  app.post('/:id/cancel', async (c) => {
    const { reason } = await body(c, z.object({ reason: z.string().min(1) }));
    return c.json(c.get('ws').services.tickets.cancel(c.get('actor'), c.req.param('id'), reason));
  });

  app.put('/:id/blockers', async (c) => {
    const { blockedBy } = await body(c, z.object({ blockedBy: z.array(z.string()) }));
    return c.json(c.get('ws').services.tickets.setBlockers(c.get('actor'), c.req.param('id'), blockedBy));
  });

  app.get('/:id/comments', (c) => c.json(c.get('ws').services.tickets.comments(c.req.param('id'), c.req.query('after'))));

  app.post('/:id/comments', async (c) => {
    const { body: text } = await body(c, z.object({ body: z.string().min(1) }));
    return c.json(c.get('ws').services.tickets.comment(c.get('actor'), c.req.param('id'), text, 'comment', 'trusted'), 201);
  });

  // VS-224: read by document id — how a decision's document target is followed. Registered before
  // the key route below so `by-id` is never consumed as a key.
  app.get('/:id/documents/by-id/:documentId', (c) => {
    const rev = c.req.query('revision');
    const doc = c.get('ws').services.tickets.getDocumentById(c.req.param('id'), c.req.param('documentId'), rev ? Number(rev) : undefined);
    if (!doc) throw new OcError('not_found', `document ${c.req.param('documentId')} not found`);
    return c.json(doc);
  });

  app.get('/:id/documents/:key', (c) => {
    const rev = c.req.query('revision');
    const doc = c.get('ws').services.tickets.getDocument(c.req.param('id'), c.req.param('key'), rev ? Number(rev) : undefined);
    if (!doc) throw new OcError('not_found', `document ${c.req.param('key')} not found`);
    return c.json(doc);
  });

  app.put('/:id/documents/:key', async (c) => {
    const { body: text } = await body(c, z.object({ body: z.string() }));
    return c.json(c.get('ws').services.tickets.putDocument(c.get('actor'), c.req.param('id'), c.req.param('key'), text));
  });

  app.get('/:id/documents/:key/revisions', (c) => c.json(c.get('ws').services.tickets.documentRevisions(c.req.param('id'), c.req.param('key'))));
  app.get('/:id/work-products', (c) => c.json(c.get('ws').services.tickets.workProducts(c.req.param('id'))));

  // VS-269: an artifact's raw HTML, verbatim, behind a sandboxing CSP. Human web session only —
  // `/tickets/**` is already excluded from RUN_TOKEN_PATHS (auth.ts), and `requireOperator` here is
  // explicit defense-in-depth for a route that serves attacker-shaped content by design.
  app.get('/:id/artifacts/:key/raw', (c) => {
    requireOperator(c);
    const rev = c.req.query('revision');
    const doc = c.get('ws').services.tickets.getDocument(c.req.param('id'), `artifact:${c.req.param('key')}`, rev ? Number(rev) : undefined);
    if (!doc) throw new OcError('not_found', `artifact ${c.req.param('key')} not found`);
    return c.text(doc.body, 200, {
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'content-security-policy': ARTIFACT_CSP,
    });
  });

  app.get('/:id/runs', (c) => {
    const s = c.get('ws').services;
    return c.json(s.runs.list({ ticketId: s.tickets.get(c.req.param('id')).id }));
  });

  app.get('/:id/usage', (c) => {
    const s = c.get('ws').services;
    return c.json(s.usage.ticket(s.tickets.get(c.req.param('id')).id));
  });

  // Knowledge context (VS-110): the hub tokens and distinct documents this ticket's own runs and its
  // subtree consumed — separate from `/usage` above, which is billed model tokens.
  app.get('/:id/knowledge-usage', (c) => {
    const s = c.get('ws').services;
    return c.json(s.knowledgeUsage.forTicket(s.tickets.get(c.req.param('id')).id));
  });

  /** Discarding unlanded work always goes through a human `discard_approval` (PLAN §15). */
  app.post('/:id/discard', async (c) => {
    const s = c.get('ws').services;
    const { force } = await body(c, z.object({ force: z.literal(true) }));
    const ticket = s.tickets.get(c.req.param('id'));
    const approved = s.decisions.list({ status: ['answered'], ticketId: ticket.id })
      .find((d) => d.kind === 'discard_approval' && d.answerKey === 'approve');
    if (!approved) {
      const decision = s.decisions.create(c.get('actor'), {
        ticketId: ticket.id, kind: 'discard_approval', owner: 'human',
        title: `Discard unlanded work on ${ticket.identifier}?`,
        context: `${ticket.title} — the worktree has work that has not landed on the default branch.`,
        options: [{ key: 'approve', label: 'Discard the work' }, { key: 'keep', label: 'Keep the worktree' }],
        correlationKey: `discard:${ticket.id}`,
      });
      return c.json({ discarded: false, decisionId: decision.id }, 202);
    }
    return c.json({ discarded: true, force, ticket: s.tickets.cancel(c.get('actor'), ticket.id, 'discarded after approval') });
  });

  return app;
}

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
