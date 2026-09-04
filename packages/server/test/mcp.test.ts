import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(() => { harness?.close(); harness = null; });

const WORKER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1' };

async function connect(claims: RunTokenClaims = WORKER): Promise<{ client: Client; h: Harness }> {
  harness = makeHarness({ listener: 'loopback' });
  const app = createApp(harness.deps);
  const token = await signRunToken(runTokenSecret(harness.runtime.ctx.db), claims);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1/mcp/runs/${claims.runId}`), {
    fetch: (url, init) => app.fetch(new Request(url, init as RequestInit)) as Promise<Response>,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, h: harness };
}

describe('MCP endpoint', () => {
  it('exposes the worker toolset over streamable HTTP', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('oc_inbox');
    expect(names).toContain('oc_ticket_transition');
    expect(names).toContain('oc_ticket_create');       // WORKER_ONLY_TOOLS
    expect(names).not.toContain('oc_role_hire');        // conductor only
    expect(names).not.toContain('oc_human_send');
    expect(tools.find((t) => t.name === 'oc_ask')?.description).toContain('gate_finding');
    await client.close();
  });

  it('exposes the conductor toolset for a conductor run token', async () => {
    const { client } = await connect({ ...WORKER, agentKind: 'conductor', ticketId: null });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('oc_role_hire');
    expect(names).toContain('oc_human_send');
    expect(names).toContain('oc_briefing');
    await client.close();
  });

  it('dispatches a tool call and returns a ToolResult', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'oc_ticket_get', arguments: { id: 'ACME-42' } });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data.ticket.identifier).toBe('ACME-42');
    await client.close();
  });

  it('returns ok:false rather than throwing for unknown ids', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'oc_ticket_get', arguments: { id: 'ACME-999' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload).toEqual({ ok: false, error: { code: 'not_found', message: 'ticket ACME-999 not found', retryable: false, details: undefined } });
    await client.close();
  });

  it('refuses a conductor-only tool for a worker', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'oc_role_hire', arguments: {} });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('forbidden');
    await client.close();
  });

  it('enforces the ticket subtree scope on writes', async () => {
    const { client, h } = await connect();
    h.tickets.set('tk_other', { ...h.tickets.get('tk_1')!, id: 'tk_other', identifier: 'ACME-99', parentId: null });
    const res = await client.callTool({ name: 'oc_ticket_comment', arguments: { id: 'ACME-99', body: 'not mine' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('forbidden');
    await client.close();
  });

  it('rejects a run token minted for a different run', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const app = createApp(harness.deps);
    const token = await signRunToken(runTokenSecret(harness.runtime.ctx.db), WORKER);
    const res = await app.fetch(new Request('http://127.0.0.1/mcp/runs/run_other', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }));
    expect(res.status).toBe(403);
  });
});

describe('agent REST mirror', () => {
  it('runs the same tools over POST /agent/tools/:tool', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const app = createApp(harness.deps);
    const token = await signRunToken(runTokenSecret(harness.runtime.ctx.db), WORKER);
    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/agent/tools/oc_ticket_comment', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: { id: 'ACME-42', body: 'status update' } }),
    }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(harness.comments.at(-1)?.body).toBe('status update');
  });

  it('lists the tools an agent may call', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const app = createApp(harness.deps);
    const token = await signRunToken(runTokenSecret(harness.runtime.ctx.db), WORKER);
    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/agent/tools', { headers: { authorization: `Bearer ${token}` } }));
    const tools = await res.json();
    expect(tools.map((t: { name: string }) => t.name)).toContain('oc_worktree_status');
    expect(tools[0].inputSchema.type).toBe('object');
  });
});
