import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const req = (h: Harness, method: string, path: string, payload?: unknown) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433/api/w/ws1${path}`, { method, headers: { ...authed(), 'content-type': 'application/json' }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) }));

/** Make `saveConfig` real enough for a route test: it swaps the in-memory config, as the daemon's does. */
function persistConfig(h: Harness): { saved: Array<{ mcpServers: Record<string, unknown> }> } {
  const saved: Array<{ mcpServers: Record<string, unknown> }> = [];
  h.runtime.ctx.saveConfig = async (next) => { saved.push(next as never); h.runtime.ctx.config = next; };
  return { saved };
}

const STDIO_SERVER = `
import { createInterface } from 'node:readline';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fake', version: '1' } } });
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' } }] } });
});
`;
function stdioServerConfig(): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'vs621-mcp-'));
  const script = join(dir, 'server.mjs');
  writeFileSync(script, STDIO_SERVER);
  return { type: 'stdio', command: process.execPath, args: [script], env: {}, headers: {}, listTimeoutMs: 15_000, callTimeoutMs: 15_000, readOnly: false };
}

describe('MCP server administration (VS-621)', () => {
  it('lists definitions with their referenced secrets and never a value', async () => {
    harness = makeHarness();
    harness.runtime.ctx.config.mcpServers['github'] = { ...(stdioServerConfig() as never), env: { TOKEN: '${MCP_GITHUB_TOKEN}' } };
    harness.runtime.services.secrets.put({ kind: 'human', id: 'h' } as never, { name: 'MCP_GITHUB_TOKEN' }, 'ghp-not-real-0000000000');
    const res = await req(harness, 'GET', '/mcp');
    expect(res.status).toBe(200);
    const json = await res.json() as { servers: Array<{ name: string; config: { type: string }; secrets: Array<{ name: string; configured: boolean }> }> };
    expect(json.servers).toHaveLength(1);
    expect(json.servers[0]!.name).toBe('github');
    expect(json.servers[0]!.config.type).toBe('stdio');
    expect(json.servers[0]!.secrets).toEqual([{ name: 'MCP_GITHUB_TOKEN', configured: true }]);
    expect(JSON.stringify(json)).not.toContain('ghp-not-real');
  });

  it('creates, updates and removes a definition, refusing an invalid one and the reserved name', async () => {
    harness = makeHarness();
    const { saved } = persistConfig(harness);
    const created = await req(harness, 'PUT', '/mcp/demo', stdioServerConfig());
    expect(created.status).toBe(200);
    expect(Object.keys(saved.at(-1)!.mcpServers)).toEqual(['demo']);
    // An invalid definition (stdio without a command) is a validation 400 and does not write.
    const before = saved.length;
    const bad = await req(harness, 'PUT', '/mcp/bad', { type: 'stdio' });
    expect(bad.status).toBe(400);
    expect((await bad.json() as { error: { code: string } }).error.code).toBe('validation');
    expect(saved).toHaveLength(before);
    // The run-scoped server's name is reserved.
    expect((await req(harness, 'PUT', '/mcp/weave-ai', { type: 'http', url: 'https://x.test' })).status).toBe(400);
    // Remove.
    expect((await req(harness, 'DELETE', '/mcp/demo')).status).toBe(200);
    expect(saved.at(-1)!.mcpServers).toEqual({});
    expect((await req(harness, 'DELETE', '/mcp/demo')).status).toBe(404);
  });

  it('sets and clears a referenced secret, never returning its value', async () => {
    harness = makeHarness();
    const set = await req(harness, 'POST', '/mcp/secrets/MCP_TEST_TOKEN', { value: 'secret-value-000000' });
    expect(set.status).toBe(200);
    expect(JSON.stringify(await set.json())).not.toContain('secret-value');
    // The harness's secret store is a double that never records the real value (fakes.ts): assert the
    // name was registered, which is the route's job, and that the value never surfaced in a response.
    expect(harness.runtime.services.secrets.has('MCP_TEST_TOKEN')).toBe(true);
    const cleared = await req(harness, 'DELETE', '/mcp/secrets/MCP_TEST_TOKEN');
    expect((await cleared.json() as { configured: boolean }).configured).toBe(false);
    expect(harness.runtime.services.secrets.has('MCP_TEST_TOKEN')).toBe(false);
  });

  it('tests a saved server by listing its tools', async () => {
    harness = makeHarness();
    harness.runtime.ctx.config.mcpServers['demo'] = stdioServerConfig() as never;
    const res = await req(harness, 'POST', '/mcp/demo/test');
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; tools: Array<{ name: string; description: string }> };
    expect(json.ok).toBe(true);
    expect(json.tools).toEqual([{ name: 'echo', description: 'echo back' }]);
  });

  it('refuses to test when a referenced secret has no value and 404s an unknown server', async () => {
    harness = makeHarness();
    harness.runtime.ctx.config.mcpServers['demo'] = { ...(stdioServerConfig() as never), env: { TOKEN: '${MCP_ABSENT}' } };
    const json = await (await req(harness, 'POST', '/mcp/demo/test')).json() as { ok: boolean; error: string; tools: unknown[] };
    expect(json.ok).toBe(false);
    expect(json.error).toContain('MCP_ABSENT');
    expect(json.tools).toEqual([]);
    expect((await req(harness, 'POST', '/mcp/ghost/test')).status).toBe(404);
  });

  it('reports a server that cannot be reached', async () => {
    harness = makeHarness();
    harness.runtime.ctx.config.mcpServers['dead'] = { type: 'stdio', command: process.execPath, args: ['-e', 'process.exit(0)'], env: {}, headers: {}, listTimeoutMs: 1000, callTimeoutMs: 1000, readOnly: false };
    const json = await (await req(harness, 'POST', '/mcp/dead/test')).json() as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBeTruthy();
  });

  // Defining or testing a stdio server runs a chosen command on the host, and the list can carry a
  // literal inline value, so every /mcp route is human-session only: no agent token may reach it.
  it('refuses a worker or weaver run token on every MCP route', async () => {
    harness = makeHarness();
    harness.deps.listener = 'loopback';
    const runToken = (kind: 'worker' | 'weaver') =>
      signRunToken(runTokenSecret(harness!.runtime.ctx.db), { workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: kind, projectId: 'p1', ticketId: null, roleId: null, planId: null, firstTurn: false } as never);
    const calls: Array<[string, string, unknown]> = [
      ['GET', '/mcp', undefined],
      ['PUT', '/mcp/demo', { type: 'stdio', command: 'npx' }],
      ['DELETE', '/mcp/demo', undefined],
      ['POST', '/mcp/demo/test', undefined],
      ['POST', '/mcp/secrets/MCP_X', { value: 'x' }],
      ['DELETE', '/mcp/secrets/MCP_X', undefined],
    ];
    for (const kind of ['worker', 'weaver'] as const) {
      const token = await runToken(kind);
      for (const [method, path, payload] of calls) {
        const res = await createApp(harness.deps).fetch(new Request(`http://127.0.0.1:7433/api/w/ws1${path}`, {
          method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
        }));
        expect([method, path, kind, res.status]).toEqual([method, path, kind, 403]);
      }
    }
  });
});
