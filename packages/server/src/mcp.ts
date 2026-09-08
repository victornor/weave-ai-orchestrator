/**
 * Streamable HTTP MCP server at `/mcp/runs/:runId`, scoped by the run token's claims.
 * One short-lived server+transport per request (stateless JSON mode) so nothing leaks between runs.
 */
import { Hono } from 'hono';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { OcError } from '@agent-conductor/shared';
import { getLogger } from '@agent-conductor/core';
import type { AppDeps, AppEnv } from './types.js';
import { jsonSchemaFor, runTool, toolsFor, type ToolCtx } from './tools.js';

const log = getLogger('http', { component: 'mcp' });

export const MCP_SERVER_NAME = 'agentconductor';

/** Build the MCP server exposing exactly the tools this run's agent may call. */
export function createMcpServer(ctx: ToolCtx, version: string): Server {
  const defs = toolsFor(ctx.claims.agentKind);
  const server = new Server({ name: MCP_SERVER_NAME, version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: defs.map((d) => ({ name: d.name, description: d.description, inputSchema: jsonSchemaFor(d) })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await runTool(req.params.name, ctx, req.params.arguments ?? {});
    // `mcpContent` (set only by `ac_inbox` today, VS-133) carries real image bytes the model can see —
    // appended after the JSON summary, never in place of it, so the agent still gets the structured
    // data even when a tool that has no images to report leaves it unset.
    const images = (result.ok && result.mcpContent) || [];
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }, ...images],
      structuredContent: result as unknown as Record<string, unknown>,
      isError: !result.ok,
    };
  });
  return server;
}

export function mcpRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.all('/runs/:runId', async (c) => {
    const principal = c.get('principal');
    if (principal.kind !== 'run') throw new OcError('unauthorized', 'the MCP endpoint requires a run token');
    const { claims } = principal;
    if (c.req.param('runId') !== claims.runId) throw new OcError('forbidden', 'run token does not match this run');
    const ws = deps.workspaces.get(claims.workspaceId);
    if (!ws) throw new OcError('not_found', `workspace ${claims.workspaceId} is not loaded`);

    const toolCtx: ToolCtx = { ws, claims, actor: c.get('actor') };
    const server = createMcpServer(toolCtx, deps.version);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close().catch((e: unknown) => log.warn({ err: e, runId: claims.runId }, 'mcp server close failed'));
    }
  });
  return app;
}
