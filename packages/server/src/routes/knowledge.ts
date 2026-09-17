import { Hono } from 'hono';
import { z } from 'zod';
import { KNOWLEDGE_SCOPES, USAGE_WINDOWS } from '@weave-ai/shared';
import type { AppEnv } from '../types.js';
import { body, query } from '../http.js';

const scopeParam = z.enum(KNOWLEDGE_SCOPES);
const project = (c: { req: { query(k: string): string | undefined } }): string | null => c.req.query('project') ?? null;

/** `project`/`window` for the knowledge-context rollups (VS-110) — same window vocabulary as `/usage`. */
const KnowledgeUsageQuery = z.object({ project: z.string().optional(), window: z.enum(USAGE_WINDOWS).default('all'), since: z.string().optional() });

export function knowledgeRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => c.json(c.get('ws').services.knowledge.lint()));
  // Knowledge-context accounting (VS-110): what runs actually consumed, not what a file estimates —
  // registered before `/:scope` so these literal two-segment paths are never read as a scope.
  app.get('/usage/summary', (c) => {
    const q = query(c, KnowledgeUsageQuery);
    return c.json(c.get('ws').services.knowledgeUsage.summary({ projectId: q.project, window: q.window }));
  });
  app.get('/usage/top', (c) => {
    const q = query(c, KnowledgeUsageQuery);
    return c.json(c.get('ws').services.knowledgeUsage.topDocuments({ projectId: q.project, window: q.window }));
  });
  app.get('/usage/never-read', (c) => {
    const q = query(c, KnowledgeUsageQuery);
    return c.json(c.get('ws').services.knowledgeUsage.neverRead({ projectId: q.project, window: q.window, ...(q.since ? { since: q.since } : {}) }));
  });
  // Linked documents and the graph come before `/:scope` so "docs" and "graph" are not parsed as scopes.
  app.get('/docs', (c) => {
    const scope = c.req.query('scope');
    return c.json(c.get('ws').services.knowledge.listDocs({ ...(scope ? { scope: scopeParam.parse(scope) } : {}), ...(c.req.query('project') !== undefined ? { projectId: project(c) } : {}) }));
  });
  app.get('/docs/:scope/:slug', (c) => c.json(c.get('ws').services.knowledge.getDoc(scopeParam.parse(c.req.param('scope')), c.req.param('slug'), project(c))));
  app.put('/docs/:scope/:slug', async (c) => {
    const { body: text, folder } = await body(c, z.object({ body: z.string().min(1), folder: z.string().min(2).optional() }));
    return c.json(c.get('ws').services.knowledge.putDoc(c.get('actor'), scopeParam.parse(c.req.param('scope')), c.req.param('slug'), text, project(c), 'human', folder));
  });
  app.delete('/docs/:scope/:slug', (c) => { c.get('ws').services.knowledge.deleteDoc(c.get('actor'), scopeParam.parse(c.req.param('scope')), c.req.param('slug'), project(c)); return c.json({ ok: true }); });
  // Move places an existing document at a different folder (or the scope root with no `folder`);
  // human/UI only — not exposed as an agent tool (VS-265, see design.md).
  app.post('/docs/:scope/:slug/move', async (c) => {
    const { folder } = await body(c, z.object({ folder: z.string().min(2).optional() }));
    return c.json(c.get('ws').services.knowledge.moveDoc(c.get('actor'), scopeParam.parse(c.req.param('scope')), c.req.param('slug'), project(c), folder));
  });
  // Every published artifact across the project's tickets (VS-270): the data is ticket-owned
  // (`ticket_work_products`), never a knowledge document — this is a second read surface over it for
  // the document explorer's Artifacts entry, not a new kind of knowledge content. `?project=` optional,
  // matching `/docs`/`/graph`/`/health` above, registered before `/:scope` for the same reason.
  app.get('/artifacts', (c) => c.json(c.get('ws').services.tickets.artifacts(project(c))));
  app.get('/graph', (c) => c.json(c.get('ws').services.knowledge.graph(project(c))));
  app.get('/health', (c) => c.json(c.get('ws').services.knowledge.health(project(c))));
  // Read-only view of the dated archive files deletion/curation already write to disk (VS-265).
  // Registered before `/:scope` for the same reason as `/docs`, `/graph`, `/health` above.
  app.get('/:scope/archive', (c) => c.json(c.get('ws').services.knowledge.listArchive(scopeParam.parse(c.req.param('scope')), project(c))));
  // The path segment is a full `knowledge/`-relative archive file path (e.g.
  // `projects/api/docs/archive/2026-09-11.md`), so it has to swallow slashes, same as
  // `/:project/capabilities/:capability{.+}` above.
  app.get('/:scope/archive/:path{.+}', (c) => c.json(c.get('ws').services.knowledge.getArchive(scopeParam.parse(c.req.param('scope')), project(c), c.req.param('path'))));
  app.get('/:scope', (c) => c.json(c.get('ws').services.knowledge.get(scopeParam.parse(c.req.param('scope')), project(c))));
  app.put('/:scope', async (c) => {
    const { body: text } = await body(c, z.object({ body: z.string() }));
    return c.json(c.get('ws').services.knowledge.replace(c.get('actor'), scopeParam.parse(c.req.param('scope')), text, 'human', project(c)));
  });
  app.post('/:scope/note', async (c) => {
    const i = await body(c, z.object({ section: z.string().min(1), text: z.string().min(1), doc: z.string().min(2).optional() }));
    return c.json(c.get('ws').services.knowledge.note(c.get('actor'), scopeParam.parse(c.req.param('scope')), i.section, i.text, project(c), i.doc));
  });
  app.get('/:scope/revisions', (c) => c.json(c.get('ws').services.knowledge.revisions(scopeParam.parse(c.req.param('scope')), project(c))));
  app.post('/:scope/revert', async (c) => {
    const { revision } = await body(c, z.object({ revision: z.number().int().min(1) }));
    return c.json(c.get('ws').services.knowledge.revert(c.get('actor'), scopeParam.parse(c.req.param('scope')), revision, project(c)));
  });
  app.post('/:scope/curate', async (c) => c.json(await c.get('ws').services.knowledge.requestCuration(c.get('actor'), scopeParam.parse(c.req.param('scope')), project(c)), 202));
  return app;
}

export function specRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/:project', (c) => c.json(c.get('ws').services.specs.listCapabilities(c.req.param('project'))));
  // Capability ids are OpenSpec paths and are routinely nested (`conductor-chat/dispatch-labels`), so the
  // param has to swallow slashes: a plain `:capability` only matches a percent-encoded id and 404s the rest.
  app.get('/:project/capabilities/:capability{.+}', (c) => c.json(c.get('ws').services.specs.getCapability(c.req.param('project'), c.req.param('capability'))));
  app.get('/:project/changes', (c) => c.json(c.get('ws').services.specs.listChanges(c.req.param('project'), c.req.query('state') as 'active' | 'archived' | undefined)));
  app.get('/:project/changes/:name', (c) => c.json(c.get('ws').services.specs.getChange(c.req.param('project'), c.req.param('name'))));
  app.get('/:project/graph', (c) => c.json(c.get('ws').services.specs.graph(c.req.param('project'))));
  app.post('/:project/reindex', async (c) => c.json(await c.get('ws').services.specs.index(c.req.param('project'))));
  return app;
}

/** `GET /search?q=&project=` — knowledge and specs in one list. */
export function searchRoute(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => {
    const s = c.get('ws').services;
    const q = z.string().min(1).parse(c.req.query('q'));
    const projectId = c.req.query('project') ?? null;
    const knowledge = safe(() => s.knowledge.search(q, projectId)) ?? [];
    const specs = safe(() => s.specs.search(q, projectId)) ?? [];
    return c.json({ query: q, results: [...knowledge, ...specs] });
  });
  return app;
}

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
