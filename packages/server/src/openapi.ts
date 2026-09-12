/** Minimal OpenAPI 3.1 document and the agent-readable `llms/api.txt`, both generated from ROUTES. */
import { ERROR_CODES, EVENT_TYPES, COMMON_TOOLS, WEAVER_TOOLS } from '@agent-conductor/shared';
import { ROUTES, type RouteRow } from './routetable.js';

const PARAM = /\{([^}]+)\}/g;

export function openApiDocument(version: string, publicUrl: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const item = (paths[r.path] ??= {});
    item[r.method.toLowerCase()] = {
      tags: [r.tag],
      summary: r.summary,
      parameters: [...r.path.matchAll(PARAM)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })),
      security: r.auth === 'open' ? [] : [{ bearerAuth: [] }, { cookieAuth: [] }],
      responses: {
        200: { description: 'OK', content: { 'application/json': { schema: {} } } },
        default: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'AgentConductor', version, description: 'Control plane for a fleet of coding agents. Errors are { error: { code, message, details?, retryable } }.' },
    servers: [{ url: publicUrl }],
    tags: [...new Set(ROUTES.map((r) => r.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Operator session token, or a run token (rt_…) on the loopback listener' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ac_session' },
      },
      schemas: {
        Error: {
          type: 'object', required: ['error'],
          properties: {
            error: {
              type: 'object', required: ['code', 'message', 'retryable'],
              properties: { code: { type: 'string', enum: [...ERROR_CODES] }, message: { type: 'string' }, details: { type: 'object' }, retryable: { type: 'boolean' } },
            },
          },
        },
        WorkspaceEvent: {
          type: 'object',
          properties: { seq: { type: 'integer' }, workspaceId: { type: 'string' }, type: { type: 'string', enum: [...EVENT_TYPES] }, entityType: { type: 'string' }, entityId: { type: 'string' }, payload: {}, createdAt: { type: 'string' } },
        },
        ToolResult: {
          oneOf: [
            { type: 'object', required: ['ok', 'data'], properties: { ok: { const: true }, data: {} } },
            { type: 'object', required: ['ok', 'error'], properties: { ok: { const: false }, error: { $ref: '#/components/schemas/Error/properties/error' } } },
          ],
        },
      },
    },
  };
}

export function llmsApiText(version: string, publicUrl: string): string {
  const byTag = new Map<string, RouteRow[]>();
  for (const r of ROUTES) { const list = byTag.get(r.tag) ?? []; list.push(r); byTag.set(r.tag, list); }
  const lines: string[] = [
    `# AgentConductor HTTP API (v1, daemon ${version})`,
    '',
    `Base: ${publicUrl}. Workspace routes are /api/w/<workspaceId>/...  JSON in, JSON out.`,
    'Auth: `Authorization: Bearer <session token>` or the ac_session cookie. Agents use a run token',
    '(`Bearer rt_...`) which is only accepted on the daemon loopback listener, and only for /mcp/runs/<runId>',
    'and /api/w/<ws>/agent/*.',
    '',
    'Errors: { "error": { "code", "message", "details?", "retryable" } }. Codes:',
    `  ${ERROR_CODES.join(', ')}`,
    '',
    'Events: GET /api/w/<ws>/events?after=<seq> is SSE with `id: <seq>`, `event: <type>`, a 15s heartbeat',
    'comment, and full replay from the durable outbox. Types:',
    `  ${EVENT_TYPES.join(', ')}`,
    '',
    'Agent tools (MCP at /mcp/runs/<runId>, or POST /api/w/<ws>/agent/tools/<tool> with {"input": {...}}):',
    `  all agents: ${COMMON_TOOLS.join(', ')}`,
    `  conductor:  ${WEAVER_TOOLS.join(', ')}`,
    '  Every tool answers { ok: true, data } or { ok: false, error } — unknown ids are not_found, never a throw.',
    '',
    '## Routes',
  ];
  for (const [tag, rows] of byTag) {
    lines.push('', `### ${tag}`);
    for (const r of rows) lines.push(`${r.method.padEnd(6)} ${r.path}${r.auth === 'run' ? '  [run token]' : r.auth === 'open' ? '  [no auth]' : ''}  — ${r.summary}`);
  }
  return lines.join('\n') + '\n';
}
