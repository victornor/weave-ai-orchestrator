import { Hono } from 'hono';
import { z } from 'zod';
import { OcError } from '@agent-conductor/shared';
import type { AppDeps, AppEnv } from '../types.js';
import { body } from '../http.js';
import { runTool, toolNamesFor, toolsFor, jsonSchemaFor, type ToolCtx } from '../tools.js';

/**
 * The MCP tools mirrored over REST for the `conductor` CLI (PLAN §9.5). Loopback listener + run token only;
 * the auth middleware enforces that, this router only checks the token matches the workspace.
 */
export function agentRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const toolCtx = (c: { get: (k: 'principal' | 'ws' | 'actor') => never }): ToolCtx => {
    const principal = c.get('principal') as unknown as { kind: string; claims?: ToolCtx['claims'] };
    if (principal.kind !== 'run' || !principal.claims) throw new OcError('unauthorized', 'agent endpoints require a run token');
    const ws = c.get('ws') as unknown as ToolCtx['ws'];
    if (principal.claims.workspaceId !== ws.id) throw new OcError('forbidden', 'run token belongs to another workspace');
    return { ws, claims: principal.claims, actor: c.get('actor') as unknown as ToolCtx['actor'], incidents: deps.incidents };
  };

  app.get('/inbox', async (c) => c.json(await runTool('ac_inbox', toolCtx(c as never), {})));

  app.get('/tools', (c) => {
    const ctx = toolCtx(c as never);
    return c.json(toolsFor(ctx.claims.agentKind).map((d) => ({ name: d.name, description: d.description, inputSchema: jsonSchemaFor(d) })));
  });

  app.post('/tools/:tool', async (c) => {
    const ctx = toolCtx(c as never);
    const name = c.req.param('tool');
    if (!toolNamesFor(ctx.claims.agentKind).includes(name)) throw new OcError('forbidden', `tool ${name} is not available to a ${ctx.claims.agentKind}`);
    const { input } = await body(c, z.object({ input: z.unknown().default({}) }));
    return c.json(await runTool(name, ctx, input));
  });

  return app;
}
