import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

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
    expect(names).toContain('ac_inbox');
    expect(names).toContain('ac_ticket_transition');
    expect(names).toContain('ac_ticket_create');       // WORKER_ONLY_TOOLS
    expect(names).not.toContain('ac_role_hire');        // conductor only
    expect(names).not.toContain('ac_human_send');
    expect(names).not.toContain('ac_run_inspect');      // no worker reads another worker's transcript
    expect(names).not.toContain('ac_run_list');
    expect(tools.find((t) => t.name === 'ac_ask')?.description).toContain('gate_finding');
    await client.close();
  });

  it('exposes the conductor toolset for a conductor run token', async () => {
    const { client } = await connect({ ...WORKER, agentKind: 'conductor', ticketId: null });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('ac_role_hire');
    expect(names).toContain('ac_human_send');
    expect(names).toContain('ac_briefing');
    expect(names).toContain('ac_run_inspect');
    expect(names).toContain('ac_run_list');
    await client.close();
  });

  it('dispatches a tool call and returns a ToolResult', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'ac_ticket_get', arguments: { id: 'ACME-42' } });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data.ticket.identifier).toBe('ACME-42');
    await client.close();
  });

  it('returns ok:false rather than throwing for unknown ids', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'ac_ticket_get', arguments: { id: 'ACME-999' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload).toEqual({ ok: false, error: { code: 'not_found', message: 'ticket ACME-999 not found', retryable: false, details: undefined } });
    await client.close();
  });

  it('refuses a conductor-only tool for a worker', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'ac_role_hire', arguments: {} });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('forbidden');
    await client.close();
  });

  it('enforces the ticket subtree scope on writes', async () => {
    const { client, h } = await connect();
    h.tickets.set('tk_other', { ...h.tickets.get('tk_1')!, id: 'tk_other', identifier: 'ACME-99', parentId: null });
    const res = await client.callTool({ name: 'ac_ticket_comment', arguments: { id: 'ACME-99', body: 'not mine' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('forbidden');
    await client.close();
  });

  it('reads a scout report on another ticket in the worker\'s own project', async () => {
    const { client, h } = await connect();
    h.tickets.set('tk_scout', { ...h.tickets.get('tk_1')!, id: 'tk_scout', identifier: 'ACME-24', kind: 'scout', parentId: null });
    h.documents.set('tk_scout\0report', ['draft', 'the finding']);
    const res = await client.callTool({ name: 'ac_ticket_document_get', arguments: { id: 'ACME-24' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({ identifier: 'ACME-24', key: 'report', revision: 2, body: 'the finding' });
    await client.close();
  });

  it('reads an earlier revision when asked for one', async () => {
    const { client, h } = await connect();
    h.documents.set('tk_1\0plan', ['v1', 'v2']);
    const res = await client.callTool({ name: 'ac_ticket_document_get', arguments: { id: 'ACME-42', key: 'plan', revision: 1 } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.data).toMatchObject({ revision: 1, body: 'v1' });
    await client.close();
  });

  it('refuses a document on a ticket in another project', async () => {
    const { client, h } = await connect();
    h.tickets.set('tk_other', { ...h.tickets.get('tk_1')!, id: 'tk_other', identifier: 'ZED-7', projectId: 'proj2', parentId: null });
    h.documents.set('tk_other\0report', ['not for you']);
    const res = await client.callTool({ name: 'ac_ticket_document_get', arguments: { id: 'ZED-7' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('forbidden');
    await client.close();
  });

  it('lets the conductor read a document in any project', async () => {
    const { client, h } = await connect({ ...WORKER, agentKind: 'conductor', projectId: null, ticketId: null });
    h.tickets.set('tk_other', { ...h.tickets.get('tk_1')!, id: 'tk_other', identifier: 'ZED-7', projectId: 'proj2', parentId: null });
    h.documents.set('tk_other\0report', ['cross-project finding']);
    const res = await client.callTool({ name: 'ac_ticket_document_get', arguments: { id: 'ZED-7' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data.body).toBe('cross-project finding');
    await client.close();
  });

  it('names the documents a ticket does have when the key is unknown', async () => {
    const { client, h } = await connect();
    h.documents.set('tk_1\0plan', ['the plan']);
    const res = await client.callTool({ name: 'ac_ticket_document_get', arguments: { id: 'ACME-42', key: 'report' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('not_found');
    expect(payload.error.details.availableKeys).toEqual(['plan']);
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
    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/agent/tools/ac_ticket_comment', {
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
    expect(tools.map((t: { name: string }) => t.name)).toContain('ac_worktree_status');
    expect(tools[0].inputSchema.type).toBe('object');
  });
  // ---------- VS-92 ----------

  it('forwards ac_ask inputs and defaults the project to the asker\'s own', async () => {
    const { client, h } = await connect();
    const res = await client.callTool({
      name: 'ac_ask',
      arguments: {
        title: 'I need a read-only token',
        inputs: [
          { key: 'token', label: 'Read-only API token', type: 'secret', required: true, secretName: 'CF_READONLY_TOKEN' },
          { key: 'regions', label: 'Regions', type: 'multiselect', choices: [{ key: 'eu', label: 'EU' }] },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    expect(h.decisionInputs.at(-1)).toMatchObject({
      // A worker names no project, so its own is the one the card shows.
      projectId: 'proj1',
      inputs: [
        { key: 'token', type: 'secret', secretName: 'CF_READONLY_TOKEN', required: true },
        { key: 'regions', type: 'multiselect', choices: [{ key: 'eu', label: 'EU' }] },
      ],
    });
    await client.close();
  });

  it('lets the asker name the project a question is about', async () => {
    const { client, h } = await connect({ ...WORKER, agentKind: 'conductor', ticketId: null, projectId: null });
    await client.callTool({ name: 'ac_ask', arguments: { title: 'Which region?', projectId: 'proj9' } });
    expect(h.decisionInputs.at(-1)).toMatchObject({ projectId: 'proj9' });
    await client.close();
  });

  it('says on ac_ask that a secret input is stored rather than answered', async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools;
    const ask = tools.find((t) => t.name === 'ac_ask')!;
    expect(ask.description).toContain('never ask for one in prose');
    expect(ask.description).toContain('answerInputs');
    await client.close();
  });

  it('gives only the conductor ac_role_set_secrets, and refuses an unregistered name', async () => {
    const worker = await connect();
    expect((await worker.client.listTools()).tools.map((t) => t.name)).not.toContain('ac_role_set_secrets');
    await worker.client.close();

    const { client, h } = await connect({ ...WORKER, agentKind: 'conductor', ticketId: null });
    const refused = await client.callTool({ name: 'ac_role_set_secrets', arguments: { id: 'role_1', names: ['NOPE'], reason: 'needs it' } });
    expect(JSON.parse((refused.content as Array<{ text: string }>)[0]!.text).ok).toBe(false);
    expect(h.roleSecrets.size).toBe(0);

    // Registered by a human answering a secret input; only then can a role list it.
    h.runtime.services.secrets.put({ kind: 'human', id: 'victor' }, { name: 'CF_READONLY_TOKEN' }, 'cf-not-a-real-token-0000000000');
    const ok = await client.callTool({ name: 'ac_role_set_secrets', arguments: { id: 'role_1', names: ['CF_READONLY_TOKEN'], reason: 'cloudflare work' } });
    expect(JSON.parse((ok.content as Array<{ text: string }>)[0]!.text).ok).toBe(true);
    expect(h.roleSecrets.get('role_1')).toEqual(['CF_READONLY_TOKEN']);
    await client.close();
  });
});
