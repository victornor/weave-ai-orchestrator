import { Hono } from 'hono';
import { OcError } from '@weave-ai/shared';
import type { AppEnv } from '../types.js';
import { requireOperator } from '../auth.js';
import { ARTIFACT_CSP } from '../artifact-csp.js';

/**
 * VS-622: serving a planner's plan-scoped artifact, the plan sibling of `routes/artifacts.ts`'s
 * workspace-scoped artifact routes. Same shared `ARTIFACT_CSP` (imported from one constant so the
 * three artifact routes can never drift apart), same human-web-session-only enforcement on the raw
 * route. Every route resolves the artifact through the named plan — `planning.get` 404s a plan that
 * is not in this workspace's database, and `planArtifacts` looks the key up under that plan alone, so
 * a key stored under another plan can never be served here.
 */
export function planArtifactRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/:planId/artifacts', (c) => {
    const ws = c.get('ws');
    const planId = c.req.param('planId');
    ws.services.planning.get(planId); // 404s a plan this workspace does not have
    return c.json(ws.services.planArtifacts.list(planId));
  });

  app.get('/:planId/artifacts/:key/revisions', (c) => {
    const ws = c.get('ws');
    const planId = c.req.param('planId');
    ws.services.planning.get(planId);
    return c.json(ws.services.planArtifacts.revisions(planId, c.req.param('key')));
  });

  app.get('/:planId/artifacts/:key/raw', (c) => {
    requireOperator(c);
    const ws = c.get('ws');
    const planId = c.req.param('planId');
    ws.services.planning.get(planId);
    const rev = c.req.query('revision');
    const doc = ws.services.planArtifacts.getRevision(planId, c.req.param('key'), rev ? Number(rev) : undefined);
    if (!doc) throw new OcError('not_found', `plan artifact ${c.req.param('key')} not found`);
    return c.text(doc.body, 200, {
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'content-security-policy': ARTIFACT_CSP,
    });
  });

  return app;
}
