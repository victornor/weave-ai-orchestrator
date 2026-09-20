/**
 * MCP server administration for the built-in `weave` runtime (VS-621):
 * - `GET /mcp` — this workspace's server definitions, each with the secret names it references and
 *   whether those secrets hold a value. Never a secret value.
 * - `PUT /mcp/:name` / `DELETE /mcp/:name` — create, replace or remove a definition.
 * - `POST /mcp/:name/test` — connect and list the server's tools with a short timeout.
 * - `POST /mcp/secrets/:name` / `DELETE /mcp/secrets/:name` — set or clear a referenced secret in
 *   the workspace secret store (the `routes/channels.ts`/`providers.ts` pattern). The value never
 *   appears in a response, a log line, an event or `workspace.yaml`.
 *
 * The connection is loaded from the `weave` runtime package by specifier at call time, like the
 * provider probe: the server has no build-time dependency on the MCP client.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { MCP_SERVER_RESERVED_NAME, McpServerSchema, OcError, WorkspaceConfigSchema, type McpServer } from '@weave-ai/shared';
import type { AppEnv, WorkspaceRuntime } from '../types.js';
import { body } from '../http.js';
import { requireOperator } from '../auth.js';

interface TestClientConfig { type: 'http' | 'stdio'; url?: string; command?: string; args?: string[]; headers?: Record<string, string>; env?: Record<string, string>; listTimeoutMs?: number; callTimeoutMs?: number; readOnly?: boolean }
interface McpTestResult { ok: boolean; tools: Array<{ name: string; description: string }>; error?: string }
type TestFn = (o: { config: TestClientConfig; env?: Record<string, string>; timeoutMs?: number }) => Promise<McpTestResult>;

const RUNTIME_PACKAGE = '@weave-ai/runtime-weave';
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const REF = /\$\{([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;

async function loadTest(): Promise<TestFn> {
  try {
    const mod = (await import(RUNTIME_PACKAGE)) as { testMcpServer?: TestFn };
    if (mod.testMcpServer) return mod.testMcpServer;
  } catch { /* fall through */ }
  throw new OcError('unavailable', 'the weave runtime package is not available in this daemon');
}

/** Every `${NAME}` a definition references, across its `env` and `headers`. */
export function mcpSecretRefs(cfg: McpServer): string[] {
  const refs = new Set<string>();
  for (const v of [...Object.values(cfg.env), ...Object.values(cfg.headers)]) for (const m of v.matchAll(REF)) refs.add(m[1]!);
  return [...refs];
}

function resolveRefs(value: string, resolve: (n: string) => string | null, missing: Set<string>): string {
  return value.replace(REF, (_m, name: string) => { const v = resolve(name); if (v == null) { missing.add(name); return ''; } return v; });
}

/** The minimal base a test-server spawn gets: PATH/HOME and friends, never the daemon's secrets. */
function testBaseEnv(): Record<string, string> {
  const env: Record<string, string> = { TERM: 'dumb' };
  for (const k of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'USER']) { const v = process.env[k]; if (v !== undefined) env[k] = v; }
  return env;
}

export interface McpServerView { name: string; config: McpServer; secrets: Array<{ name: string; configured: boolean }> }

function viewOf(ws: WorkspaceRuntime, name: string, cfg: McpServer): McpServerView {
  return { name, config: cfg, secrets: mcpSecretRefs(cfg).map((n) => ({ name: n, configured: ws.services.secrets.value(n) !== null })) };
}

const SecretBodySchema = z.object({ value: z.string().min(1) });

export function mcpServerRoutes(deps: { test?: TestFn } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    // A definition may carry a literal `env`/`headers` value a human typed inline, so the list is an
    // operator surface too, not just the writes; agent tokens are refused (VS-621 review).
    requireOperator(c);
    const ws = c.get('ws');
    const servers = Object.entries(ws.ctx.config.mcpServers ?? {}).map(([name, cfg]) => viewOf(ws, name, cfg));
    return c.json({ servers });
  });

  // Registered before `/:name/test` so `/secrets/:name` is never read as a server's test.
  app.post('/secrets/:name', async (c) => {
    requireOperator(c);
    const ws = c.get('ws');
    const name = c.req.param('name');
    if (!SECRET_NAME.test(name)) throw new OcError('validation', `"${name}" cannot be a secret name`);
    const { value } = await body(c, SecretBodySchema);
    ws.services.secrets.put(c.get('actor'), { name, envVarName: name, scope: 'workspace' }, value);
    return c.json({ ok: true, name, configured: true });
  });

  app.delete('/secrets/:name', (c) => {
    requireOperator(c);
    const ws = c.get('ws');
    const name = c.req.param('name');
    ws.services.secrets.clear(c.get('actor'), name);
    return c.json({ ok: true, name, configured: false });
  });

  app.put('/:name', async (c) => {
    requireOperator(c);
    const ws = c.get('ws');
    const name = c.req.param('name');
    if (!NAME.test(name)) throw new OcError('validation', `MCP server name "${name}" must be lower-case kebab-case`);
    if (name === MCP_SERVER_RESERVED_NAME) throw new OcError('validation', `"${MCP_SERVER_RESERVED_NAME}" is the run-scoped server's name and cannot be redefined`);
    const parsed = McpServerSchema.safeParse(await body(c, z.record(z.string(), z.unknown())));
    if (!parsed.success) throw new OcError('validation', `the MCP server ${name} is invalid`, { issues: parsed.error.issues });
    const merged = WorkspaceConfigSchema.safeParse({ ...ws.ctx.config, mcpServers: { ...ws.ctx.config.mcpServers, [name]: parsed.data } });
    if (!merged.success) throw new OcError('validation', 'the workspace config would be invalid', { issues: merged.error.issues });
    await ws.ctx.saveConfig(merged.data);
    ws.ctx.events.emit('workspace.updated', 'workspace', ws.id, { config: merged.data });
    return c.json(viewOf(ws, name, parsed.data));
  });

  app.delete('/:name', async (c) => {
    requireOperator(c);
    const ws = c.get('ws');
    const name = c.req.param('name');
    const all = { ...ws.ctx.config.mcpServers };
    if (!all[name]) throw new OcError('not_found', `MCP server ${name} is not configured in this workspace`);
    delete all[name];
    const merged = WorkspaceConfigSchema.safeParse({ ...ws.ctx.config, mcpServers: all });
    if (!merged.success) throw new OcError('validation', 'the workspace config would be invalid', { issues: merged.error.issues });
    await ws.ctx.saveConfig(merged.data);
    ws.ctx.events.emit('workspace.updated', 'workspace', ws.id, { config: merged.data });
    return c.json({ ok: true });
  });

  app.post('/:name/test', async (c) => {
    requireOperator(c);
    const ws = c.get('ws');
    const name = c.req.param('name');
    const cfg = ws.ctx.config.mcpServers?.[name];
    if (!cfg) throw new OcError('not_found', `MCP server ${name} is not configured in this workspace`);
    const missing = new Set<string>();
    const resolve = (n: string): string | null => ws.services.secrets.value(n);
    const env = Object.fromEntries(Object.entries(cfg.env).map(([k, v]) => [k, resolveRefs(v, resolve, missing)]));
    const headers = Object.fromEntries(Object.entries(cfg.headers).map(([k, v]) => [k, resolveRefs(v, resolve, missing)]));
    if (missing.size > 0) return c.json({ name, ok: false, tools: [], error: `referenced secret(s) have no value: ${[...missing].join(', ')}` });
    const config: TestClientConfig = cfg.type === 'stdio'
      ? { type: 'stdio', command: cfg.command ?? '', args: cfg.args, env, listTimeoutMs: cfg.listTimeoutMs, callTimeoutMs: cfg.callTimeoutMs, readOnly: cfg.readOnly }
      : { type: 'http', url: cfg.url ?? '', headers, listTimeoutMs: cfg.listTimeoutMs, callTimeoutMs: cfg.callTimeoutMs, readOnly: cfg.readOnly };
    const report = await (deps.test ?? await loadTest())({ config, env: testBaseEnv(), timeoutMs: 15_000 });
    return c.json({ name, ...report });
  });

  return app;
}
