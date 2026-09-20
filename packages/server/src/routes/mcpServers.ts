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
 * VS-633: the same handlers serve two scopes. Under `/api/daemon/mcp-servers` they administer the
 * daemon's servers and its own secret store (visible to every workspace); per workspace they return
 * the merged view marked `daemon`, `workspace` or `override`, write only the workspace's own entries,
 * and `POST/DELETE /:name/disable` hides an inherited server from one workspace.
 *
 * The connection is loaded from the `weave` runtime package by specifier at call time, like the
 * provider probe: the server has no build-time dependency on the MCP client.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Context } from 'hono';
import { DaemonConfigSchema, MCP_SERVER_RESERVED_NAME, McpServerSchema, OcError, WorkspaceConfigSchema, disabledInherited, type ConfigSource, type McpServer } from '@weave-ai/shared';
import { daemonSecretStore, resolveScopedSecret, scopedMcpServers, workspaceLoader } from '@weave-ai/core';
import type { AppDeps, AppEnv } from '../types.js';
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

export interface McpServerView { name: string; config: McpServer; secrets: Array<{ name: string; configured: boolean }>; source?: ConfigSource }

interface Scope {
  level: 'daemon' | 'workspace';
  own(): Record<string, McpServer>;
  save(next: Record<string, McpServer>): Promise<void>;
  view(): Array<{ name: string; config: McpServer; source: ConfigSource }>;
  disabled(): Array<{ name: string; config: McpServer }>;
  setDisabled?(next: string[]): Promise<void>;
  disabledNames?(): string[];
  secretValue(name: string): string | null;
  putSecret(actor: unknown, name: string, value: string): void;
  clearSecret(actor: unknown, name: string): void;
}

function workspaceScope(c: Context<AppEnv>): Scope {
  const ws = c.get('ws');
  const daemonStore = () => daemonSecretStore(ws.ctx.daemonConfigDir);
  const saveWs = async (next: Record<string, unknown>): Promise<void> => {
    const merged = WorkspaceConfigSchema.safeParse({ ...ws.ctx.config, ...next });
    if (!merged.success) throw new OcError('validation', 'the workspace config would be invalid', { issues: merged.error.issues });
    await ws.ctx.saveConfig(merged.data);
    ws.ctx.events.emit('workspace.updated', 'workspace', ws.id, { config: merged.data });
  };
  return {
    level: 'workspace',
    own: () => ws.ctx.config.mcpServers ?? {},
    save: (mcpServers) => saveWs({ mcpServers }),
    view: () => Object.entries(scopedMcpServers(ws.ctx)).map(([name, e]) => ({ name, config: e.value, source: e.source })),
    disabled: () => disabledInherited({ daemon: ws.ctx.daemon?.mcpServers, workspace: ws.ctx.config.mcpServers, disabled: ws.ctx.config.disabledMcpServers })
      .map((name) => ({ name, config: ws.ctx.daemon.mcpServers[name]! })),
    setDisabled: (disabledMcpServers) => saveWs({ disabledMcpServers }),
    disabledNames: () => ws.ctx.config.disabledMcpServers ?? [],
    secretValue: (n) => resolveScopedSecret((x) => ws.services.secrets.value(x), daemonStore(), n),
    putSecret: (actor, name, value) => ws.services.secrets.put(actor as never, { name, envVarName: name, scope: 'workspace' }, value),
    clearSecret: (actor, name) => ws.services.secrets.clear(actor as never, name),
  };
}

function daemonScope(c: Context<AppEnv>, deps: AppDeps): Scope {
  const store = () => daemonSecretStore(deps.daemonConfigDir ?? '');
  const needStore = () => { const st = store(); if (!st) throw new OcError('unavailable', 'this daemon has no config directory to hold secrets in'); return st; };
  return {
    level: 'daemon',
    own: () => deps.daemon.mcpServers ?? {},
    async save(mcpServers) {
      deps.daemon.mcpServers = mcpServers;
      if (deps.daemonConfigDir) {
        const current = workspaceLoader.readDaemonConfig(deps.daemonConfigDir);
        workspaceLoader.writeDaemonConfig(DaemonConfigSchema.parse({ ...current, mcpServers }), deps.daemonConfigDir);
      }
    },
    view: () => Object.entries(deps.daemon.mcpServers ?? {}).map(([name, config]) => ({ name, config, source: 'daemon' as const })),
    disabled: () => [],
    secretValue: (n) => store()?.get(n) ?? null,
    putSecret: (_actor, name, value) => needStore().put(name, value),
    clearSecret: (_actor, name) => store()?.clear(name),
  };
}

const SecretBodySchema = z.object({ value: z.string().min(1) });

export function mcpServerRoutes(deps: { test?: TestFn; daemon?: AppDeps } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // A definition may carry a literal `env`/`headers` value a human typed inline, so every route here
  // is an operator surface, reads included; agent tokens are refused (VS-621 review).
  const scopeOf = (c: Context<AppEnv>): Scope => { requireOperator(c); return deps.daemon ? daemonScope(c, deps.daemon) : workspaceScope(c); };
  const viewOf = (scope: Scope, name: string, cfg: McpServer, source?: ConfigSource): McpServerView => ({
    name, config: cfg, secrets: mcpSecretRefs(cfg).map((n) => ({ name: n, configured: scope.secretValue(n) !== null })), ...(source ? { source } : {}),
  });
  const where = (scope: Scope) => (scope.level === 'daemon' ? 'in the daemon settings' : 'in this workspace');
  const ownOf = (scope: Scope, name: string): McpServer => {
    const cfg = scope.own()[name];
    if (cfg) return cfg;
    if (scope.view().some((e) => e.name === name)) throw new OcError('validation', `MCP server ${name} is inherited from the daemon settings; change it there, or override it in this workspace first`);
    throw new OcError('not_found', `MCP server ${name} is not configured ${where(scope)}`);
  };

  app.get('/', (c) => {
    const scope = scopeOf(c);
    const servers = scope.view().map((e) => viewOf(scope, e.name, e.config, e.source));
    const disabled = scope.disabled().map((e) => viewOf(scope, e.name, e.config, 'daemon'));
    return c.json({ servers, ...(scope.level === 'workspace' ? { disabled } : {}) });
  });

  // Registered before `/:name/test` so `/secrets/:name` is never read as a server's test.
  app.post('/secrets/:name', async (c) => {
    const scope = scopeOf(c);
    const name = c.req.param('name');
    if (!SECRET_NAME.test(name)) throw new OcError('validation', `"${name}" cannot be a secret name`);
    const { value } = await body(c, SecretBodySchema);
    scope.putSecret(c.get('actor'), name, value);
    return c.json({ ok: true, name, configured: true });
  });

  app.delete('/secrets/:name', (c) => {
    const scope = scopeOf(c);
    const name = c.req.param('name');
    scope.clearSecret(c.get('actor'), name);
    return c.json({ ok: true, name, configured: false });
  });

  app.put('/:name', async (c) => {
    const scope = scopeOf(c);
    const name = c.req.param('name');
    if (!NAME.test(name)) throw new OcError('validation', `MCP server name "${name}" must be lower-case kebab-case`);
    if (name === MCP_SERVER_RESERVED_NAME) throw new OcError('validation', `"${MCP_SERVER_RESERVED_NAME}" is the run-scoped server's name and cannot be redefined`);
    const parsed = McpServerSchema.safeParse(await body(c, z.record(z.string(), z.unknown())));
    if (!parsed.success) throw new OcError('validation', `the MCP server ${name} is invalid`, { issues: parsed.error.issues });
    await scope.save({ ...scope.own(), [name]: parsed.data });
    const source = scope.level === 'daemon' ? 'daemon' : scope.view().find((e) => e.name === name)?.source;
    return c.json(viewOf(scope, name, parsed.data, source));
  });

  app.delete('/:name', async (c) => {
    const scope = scopeOf(c);
    const name = c.req.param('name');
    ownOf(scope, name);
    const all = { ...scope.own() };
    delete all[name];
    await scope.save(all);
    return c.json({ ok: true });
  });

  app.post('/:name/disable', async (c) => {
    const scope = scopeOf(c);
    const name = c.req.param('name');
    if (!scope.setDisabled) throw new OcError('validation', 'only a workspace can disable an inherited MCP server');
    if (scope.own()[name]) throw new OcError('validation', `MCP server ${name} is this workspace's own; remove it instead`);
    if (!scope.view().some((e) => e.name === name && e.source === 'daemon')) throw new OcError('not_found', `no inherited MCP server ${name} to disable`);
    await scope.setDisabled([...new Set([...(scope.disabledNames?.() ?? []), name])]);
    return c.json({ ok: true, disabled: true });
  });

  app.delete('/:name/disable', async (c) => {
    const scope = scopeOf(c);
    const name = c.req.param('name');
    if (!scope.setDisabled) throw new OcError('validation', 'only a workspace can disable an inherited MCP server');
    await scope.setDisabled((scope.disabledNames?.() ?? []).filter((x) => x !== name));
    return c.json({ ok: true, disabled: false });
  });

  app.post('/:name/test', async (c) => {
    const scope = scopeOf(c);
    const name = c.req.param('name');
    const cfg = scope.view().find((e) => e.name === name)?.config;
    if (!cfg) throw new OcError('not_found', `MCP server ${name} is not configured ${where(scope)}`);
    const missing = new Set<string>();
    const resolve = (n: string): string | null => scope.secretValue(n);
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
