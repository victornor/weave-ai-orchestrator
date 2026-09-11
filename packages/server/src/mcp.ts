/**
 * Streamable HTTP MCP server at `/mcp/runs/:runId`, scoped by the run token's claims.
 * One short-lived server+transport per request (stateless JSON mode) so nothing leaks between runs.
 */
import { Hono } from 'hono';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { OcError, type ToolResult } from '@agent-conductor/shared';
import { getLogger } from '@agent-conductor/core';
import type { AppDeps, AppEnv } from './types.js';
import { jsonSchemaFor, runTool, toolsFor, type ToolCtx } from './tools.js';

const log = getLogger('http', { component: 'mcp' });

export const MCP_SERVER_NAME = 'agentconductor';
export const MCP_LIST_RESULT_CAP = 64 * 1024;
const LIST_TOOLS = new Set(['ac_ticket_list', 'ac_incident_list']);

/** Encode a tool result for MCP. List tools are capped at MCP_LIST_RESULT_CAP with `truncated: true`. */
export function encodeMcpToolResult(name: string, result: ToolResult<unknown>): string {
  if (!LIST_TOOLS.has(name) || !result.ok) return JSON.stringify(result);
  return JSON.stringify(capListResult(result, MCP_LIST_RESULT_CAP));
}

/** Drop trailing list items until the JSON fits `cap`. Get-by-id results are never passed here. */
export function capListResult(result: ToolResult<unknown>, cap: number): ToolResult<unknown> {
  if (JSON.stringify(result).length <= cap) return result;
  if (!result.ok || result.data === null || typeof result.data !== 'object') return result;
  const data = result.data as { items?: unknown[] };
  if (!Array.isArray(data.items)) return result;
  let items = data.items;
  while (items.length > 0) {
    const next: ToolResult<unknown> = { ok: true, data: { ...data, items, truncated: true } };
    if (JSON.stringify(next).length <= cap) return next;
    items = items.slice(0, -1);
  }
  return { ok: true, data: { ...data, items: [], truncated: true } };
}

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
    const text = encodeMcpToolResult(req.params.name, result);
    return {
      content: [{ type: 'text' as const, text }, ...images],
      structuredContent: JSON.parse(text) as Record<string, unknown>,
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

    const toolCtx: ToolCtx = { ws, claims, actor: c.get('actor'), incidents: deps.incidents };
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
