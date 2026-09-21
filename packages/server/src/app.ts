/**
 * The Hono app implementing docs/API.md. One factory, two mounts: the public listener and the
 * loopback listener get their own instance (they differ only in `deps.listener`, which decides
 * whether run tokens are honoured).
 */
import { Hono } from 'hono';
import { OcError, PUSH_BASE } from '@weave-ai/shared';
import type { AppDeps, AppEnv } from './types.js';
import { authMiddleware } from './auth.js';
import { onError } from './http.js';
import { mcpRoutes } from './mcp.js';
import { staticRoutes } from './static.js';
import { openApiDocument, llmsApiText } from './openapi.js';
import { presentationRoutes, presenterRoutes } from './presenter.js';
import { pushRoutes } from './push.js';
import { authRoutes } from './routes/auth.js';
import { daemonRoutes, type WorkspaceAdmin } from './routes/daemon.js';
import { workspaceRoutes } from './routes/workspace.js';
import { eventRoutes, globalEventRoutes } from './routes/events.js';
import { modelRoutes } from './routes/models.js';
import { providerRoutes } from './routes/providers.js';
import { mcpServerRoutes } from './routes/mcpServers.js';
import { projectRoutes } from './routes/projects.js';
import { jobRoutes } from './routes/jobs.js';
import { roleRoutes } from './routes/roles.js';
import { workerRoutes, conductorRoutes } from './routes/workers.js';
import { worktreeRoutes } from './routes/worktrees.js';
import { ticketRoutes } from './routes/tickets.js';
import { decisionRoutes } from './routes/decisions.js';
import { runRoutes } from './routes/runs.js';
import { knowledgeRoutes, specRoutes, searchRoute } from './routes/knowledge.js';
import { changelogRoutes } from './routes/changelog.js';
import { usageRoutes } from './routes/usage.js';
import { threadRoutes } from './routes/threads.js';
import { agentRoutes } from './routes/agent.js';
import { channelRoutes } from './routes/channels.js';
import { routineRoutes } from './routes/routines.js';
import { artifactRoutes } from './routes/artifacts.js';
import { planArtifactRoutes } from './routes/plans.js';
import { pluginRoutes } from './routes/plugins.js';
import { pluginDataRoutes } from './routes/plugin-data.js';

export type { WorkspaceAdmin };

export function createApp(deps: AppDeps, admin: WorkspaceAdmin | null = null): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(onError);

  app.use('/api/*', authMiddleware(deps));
  app.use('/mcp/*', authMiddleware(deps));

  // ---- discovery (open) ----
  app.get('/api/openapi.json', (c) => c.json(openApiDocument(deps.version, deps.publicUrl)));
  app.get('/llms/api.txt', (c) => c.text(llmsApiText(deps.version, deps.publicUrl), 200, { 'content-type': 'text/plain; charset=utf-8' }));

  // ---- daemon level ----
  app.route('/api/auth', authRoutes(deps));
  app.route('/api/daemon/providers', providerRoutes({ daemon: deps }));
  app.route('/api/daemon/mcp-servers', mcpServerRoutes({ daemon: deps }));
  app.route('/api', daemonRoutes(deps, admin));
  app.route('/api/events', globalEventRoutes(deps));

  // ---- one workspace ----
  const ws = new Hono<AppEnv>();
  ws.use('*', async (c, next) => {
    const id = c.req.param('ws');
    const found = id ? deps.workspaces.get(id) : undefined;
    if (!found) throw new OcError('not_found', `workspace ${id ?? ''} is not loaded`);
    c.set('ws', found);
    await next();
  });
  ws.route('/', workspaceRoutes(deps));
  ws.route('/events', eventRoutes());
  ws.route('/models', modelRoutes());
  ws.route('/mcp', mcpServerRoutes());
  ws.route('/projects', projectRoutes());
  ws.route('/jobs', jobRoutes());
  ws.route('/roles', roleRoutes());
  ws.route('/workers', workerRoutes());
  ws.route('/weaver', conductorRoutes());
  ws.route('/tickets', ticketRoutes());
  ws.route('/decisions', decisionRoutes());
  ws.route('/runs', runRoutes());
  ws.route('/knowledge', knowledgeRoutes());
  ws.route('/changelog', changelogRoutes());
  ws.route('/specs', specRoutes());
  ws.route('/search', searchRoute());
  ws.route('/usage', usageRoutes());
  ws.route('/threads', threadRoutes());
  ws.route('/worktrees', worktreeRoutes());
  ws.route('/presentation', presentationRoutes(deps));
  ws.route('/presenter', presenterRoutes(deps));
  ws.route(PUSH_BASE, pushRoutes(deps));
  ws.route('/agent', agentRoutes(deps));
  ws.route('/channels', channelRoutes());
  ws.route('/routines', routineRoutes());
  ws.route('/artifacts', artifactRoutes());
  ws.route('/plans', planArtifactRoutes());
  ws.route('/plugins', pluginRoutes());
  ws.route('/plugin-data', pluginDataRoutes());
  app.route('/api/w/:ws', ws);

  // ---- MCP (loopback listener, run tokens) ----
  app.route('/mcp', mcpRoutes(deps));

  // ---- 404 for the API surface before the SPA fallback swallows everything ----
  app.all('/api/*', (c) => { throw new OcError('not_found', `no route for ${c.req.method} ${c.req.path}`); });
  app.all('/mcp/*', (c) => { throw new OcError('not_found', `no route for ${c.req.method} ${c.req.path}`); });

  // ---- static UI ----
  app.route('/', staticRoutes(deps.uiDir));
  return app;
}
