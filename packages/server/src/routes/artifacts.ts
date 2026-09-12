import { Hono } from 'hono';
import { ARTIFACT_KIT_CSS } from '@weave-ai/core';
import { OcError } from '@weave-ai/shared';
import type { AppEnv } from '../types.js';
import { requireOperator } from '../auth.js';
import { ARTIFACT_CSP } from '../artifact-csp.js';

/**
 * `GET /api/w/:ws/artifacts/kit.css` — the AC Artifact Kit's CSS at a stable, session-authenticated
 * asset path (VS-269/design.md Decision 5), so the web app's artifact-download action can inline it
 * without a second, drift-prone copy of the CSS reaching the browser bundle.
 *
 * `GET /api/w/:ws/artifacts` and `GET /api/w/:ws/artifacts/:key/raw` (VS-297) are the workspace-scoped
 * siblings of the ticket-scoped artifact list/raw-serve routes in `routes/tickets.ts` — same CSP
 * (imported from one shared constant so the two can never drift apart), same human-web-session-only
 * enforcement, for a weaver's artifact, which has no ticket to be scoped to instead.
 */
export function artifactRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/kit.css', (c) => c.text(ARTIFACT_KIT_CSS, 200, { 'content-type': 'text/css; charset=utf-8' }));

  app.get('/', (c) => c.json(c.get('ws').services.weaverArtifacts.list(c.get('ws').id)));

  app.get('/:key/revisions', (c) => c.json(c.get('ws').services.weaverArtifacts.revisions(c.get('ws').id, c.req.param('key'))));

  app.get('/:key/raw', (c) => {
    requireOperator(c);
    const ws = c.get('ws');
    const rev = c.req.query('revision');
    const doc = ws.services.weaverArtifacts.getRevision(ws.id, c.req.param('key'), rev ? Number(rev) : undefined);
    if (!doc) throw new OcError('not_found', `artifact ${c.req.param('key')} not found`);
    return c.text(doc.body, 200, {
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'content-security-policy': ARTIFACT_CSP,
    });
  });

  return app;
}
