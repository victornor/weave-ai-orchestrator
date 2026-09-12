import { Hono } from 'hono';
import { ARTIFACT_KIT_CSS } from '@agent-conductor/core';
import type { AppEnv } from '../types.js';

/**
 * `GET /api/w/:ws/artifacts/kit.css` — the AC Artifact Kit's CSS at a stable, session-authenticated
 * asset path (VS-269/design.md Decision 5), so the web app's artifact-download action can inline it
 * without a second, drift-prone copy of the CSS reaching the browser bundle.
 */
export function artifactRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/kit.css', (c) => c.text(ARTIFACT_KIT_CSS, 200, { 'content-type': 'text/css; charset=utf-8' }));
  return app;
}
