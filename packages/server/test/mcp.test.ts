import { afterEach, describe, expect, it } from 'vitest';
import { ASKABLE_DECISION_KINDS, DECISION_KINDS, OcError, ok } from '@weave-ai/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { capListResult, encodeMcpToolResult, MCP_LIST_RESULT_CAP } from '../src/mcp.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { makeHarness, wakeup, type Harness } from './fakes.js';

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
    expect(names).toContain('weave_inbox');
    expect(names).toContain('weave_incident');
    expect(names).toContain('weave_ticket_transition');
    expect(names).toContain('weave_ticket_create');       // WORKER_ONLY_TOOLS
    expect(names).not.toContain('weave_role_hire');        // conductor only
    expect(names).not.toContain('weave_routine_create');
    expect(names).not.toContain('weave_human_send');
    expect(names).not.toContain('weave_thread_message_get');
    expect(names).not.toContain('weave_decision_review');
    expect(names).not.toContain('weave_run_inspect');      // no worker reads another worker's transcript
    expect(names).not.toContain('weave_run_list');
    expect(names).not.toContain('weave_worker_models');
    expect(tools.find((t) => t.name === 'weave_ask')?.description).toContain('gate_finding');
    await client.close();
  });

  it('scopes an interactive opening turn to the first-turn tools (VS-462)', async () => {
    const { client } = await connect({ ...WORKER, firstTurn: true });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect([...names].sort()).toEqual(['weave_inbox', 'weave_ticket_comment', 'weave_ticket_comments', 'weave_ticket_document_get', 'weave_ticket_get']);
    expect(names).not.toContain('weave_worktree_status');
    expect(names).not.toContain('weave_ticket_transition');

    // The hold is a fact of the token, not prompt wording: a direct call is refused.
    const refused = await client.callTool({ name: 'weave_worktree_status', arguments: {} });
    const refusedPayload = JSON.parse((refused.content as Array<{ text: string }>)[0]!.text);
    expect(refusedPayload.ok).toBe(false);
    expect(refusedPayload.error.code).toBe('forbidden');

    // Reading the ticket and commenting still work.
    const got = await client.callTool({ name: 'weave_ticket_get', arguments: { id: 'ACME-42' } });
    expect(JSON.parse((got.content as Array<{ text: string }>)[0]!.text).ok).toBe(true);
    await client.close();
  });

  it('exposes the conductor toolset for a conductor run token', async () => {
    const { client } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('weave_role_hire');
    expect(names).toContain('weave_human_send');
    expect(names).toContain('weave_thread_message_get');
    expect(names).toContain('weave_decision_review');
    expect(names).toContain('weave_briefing');
    expect(names).toContain('weave_worker_models');
    expect((await client.listTools()).tools.find((t) => t.name === 'weave_worker_models')?.description).toMatch(/unconfigured/);
    expect(names).toContain('weave_run_inspect');
    expect(names).toContain('weave_run_list');
    expect(names).toContain('weave_routine_list');
    expect(names).toContain('weave_routine_create');
    await client.close();
  });

  it('a plugin tool appears in the MCP tools/list and is callable through tools/call (VS-334)', async () => {
    harness = makeHarness({ listener: 'loopback' });
    harness.runtime.ctx.plugins.tools.push({
      name: 'demo_greet', description: 'says hi', inputSchema: { type: 'object', properties: {} }, scope: 'all',
      handler: async () => ({ greeting: 'hi' }),
    });
    const app = createApp(harness.deps);
    const token = await signRunToken(runTokenSecret(harness.runtime.ctx.db), WORKER);
    const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1/mcp/runs/${WORKER.runId}`), {
      fetch: (url, init) => app.fetch(new Request(url, init as RequestInit)) as Promise<Response>,
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('demo_greet');
    const res = await client.callTool({ name: 'demo_greet', arguments: {} });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload).toEqual({ ok: true, data: { greeting: 'hi' } });
    await client.close();
  });

  it('dispatches a tool call and returns a ToolResult', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'weave_ticket_get', arguments: { id: 'ACME-42' } });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data.ticket.identifier).toBe('ACME-42');
    await client.close();
  });

  it('weave_artifact_kit returns the kit and reference material to a worker and a conductor alike', async () => {
    const worker = await connect();
    const workerRes = await worker.client.callTool({ name: 'weave_artifact_kit', arguments: {} });
    const workerPayload = JSON.parse((workerRes.content as Array<{ text: string }>)[0]!.text);
    expect(workerPayload.ok).toBe(true);
    expect(workerPayload.data.css).toContain("[data-theme='dark']");
    expect(workerPayload.data.tokens.dark['--status-blocked']).toMatch(/^#/);
    expect(workerPayload.data.tokens.scale['--space-1']).toBeTruthy();
    expect(workerPayload.data.components.some((c: { className: string }) => c.className === 'card')).toBe(true);
    expect(workerPayload.data.playbooks).toBeTypeOf('object');
    await worker.client.close();

    const conductor = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null });
    const conductorRes = await conductor.client.callTool({ name: 'weave_artifact_kit', arguments: {} });
    const conductorPayload = JSON.parse((conductorRes.content as Array<{ text: string }>)[0]!.text);
    expect(conductorPayload.ok).toBe(true);
    expect(conductorPayload.data.css).toBe(workerPayload.data.css);
    await conductor.client.close();
  });

  it('returns ok:false rather than throwing for unknown ids', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'weave_ticket_get', arguments: { id: 'ACME-999' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload).toEqual({ ok: false, error: { code: 'not_found', message: 'ticket ACME-999 not found', retryable: false, details: undefined } });
    await client.close();
  });

  it('refuses a weaver-only tool for a worker', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'weave_role_hire', arguments: {} });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('forbidden');
    await client.close();
  });

  it('weave_decision_review succeeds for the conductor and 403s a worker with no row change (VS-223)', async () => {
    const worker = await connect();
    const before = worker.h.runtime.services.decisions.get('dec_1');
    const refused = await worker.client.callTool({
      name: 'weave_decision_review',
      arguments: { decisionId: 'dec_1', status: 'looked', note: 'plan matches the ticket' },
    });
    const refusedPayload = JSON.parse((refused.content as Array<{ text: string }>)[0]!.text);
    expect(refusedPayload.ok).toBe(false);
    expect(refusedPayload.error.code).toBe('forbidden');
    expect(worker.h.runtime.services.decisions.get('dec_1')).toEqual(before);
    await worker.client.close();

    const conductor = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null, agentId: 'ag_conductor' });
    const created = conductor.h.runtime.services.decisions.create(
      { kind: 'agent', id: 'ag_conductor' },
      { title: 'Approve the plan', kind: 'plan_approval' },
    );
    const okRes = await conductor.client.callTool({
      name: 'weave_decision_review',
      arguments: { decisionId: created.id, status: 'looked', note: 'plan matches the ticket' },
    });
    const okPayload = JSON.parse((okRes.content as Array<{ text: string }>)[0]!.text);
    expect(okPayload.ok).toBe(true);
    expect(okPayload.data.weaverReviewStatus).toBe('looked');
    expect(okPayload.data.weaverReviewNote).toBe('plan matches the ticket');
    await conductor.client.close();
  });

  it.each(['plan_approval', 'merge_approval', 'hire_approval', 'discard_approval', 'retry_approval', 'approval'])(
    'refuses to construct a %s decision through weave_ask, for a worker or the conductor',
    async (kind) => {
      const { client, h } = await connect();
      const before = h.decisionInputs.length;
      const res = await client.callTool({ name: 'weave_ask', arguments: { kind, title: 'x' } });
      const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
      expect(payload.ok).toBe(false);
      expect(h.decisionInputs.length).toBe(before);
      await client.close();
    },
  );

  it('weave_ask never hard-codes an owner — ownership is left to the service to resolve (VS-127)', async () => {
    // The regression this guards: `weave_ask`'s handler used to pass `owner` itself, keyed only off
    // `kind`, which is how a worker's default `question` ended up in the human's queue. The service
    // layer (`decisions/service.ts`'s `defaultOwner`, covered directly in decisions.test.ts) is
    // what must resolve ownership now, from who asked — this only proves the tool stopped
    // second-guessing it.
    const { client, h } = await connect();
    for (const kind of ['question', 'concern', 'gate_finding'] as const) {
      const res = await client.callTool({ name: 'weave_ask', arguments: { kind, title: kind } });
      const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
      expect(payload.ok).toBe(true);
    }
    expect(h.decisionInputs.every((i) => i.owner === undefined)).toBe(true);
    await client.close();
  });

  it('enforces the ticket subtree scope on writes', async () => {
    const { client, h } = await connect();
    h.tickets.set('tk_other', { ...h.tickets.get('tk_1')!, id: 'tk_other', identifier: 'ACME-99', parentId: null });
    const res = await client.callTool({ name: 'weave_ticket_comment', arguments: { id: 'ACME-99', body: 'not mine' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('forbidden');
    await client.close();
  });

  it('relays a human-owned askable decision and refuses every approval, driven off DECISION_KINDS (VS-310)', async () => {
    const { client, h } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null, agentId: 'ag_conductor' });
    const weaver = { kind: 'agent', id: 'ag_conductor' } as never;
    let answerCalls = 0;
    for (const kind of DECISION_KINDS) {
      const d = h.runtime.services.decisions.create(weaver, { kind, title: kind, owner: 'human' });
      const res = await client.callTool({
        name: 'weave_decision_answer',
        arguments: { id: d.id, text: 'captain said so', relayMessageId: 'msg_1' },
      });
      const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
      if ((ASKABLE_DECISION_KINDS as readonly string[]).includes(kind)) {
        expect(payload.ok, `${kind} should be relayable`).toBe(true);
        answerCalls += 1;
      } else {
        expect(payload.ok, `${kind} must be refused`).toBe(false);
        expect(payload.error.code, `${kind} keeps the forbidden answer`).toBe('forbidden');
      }
    }
    // The askable relaying actually reached the service with the message named, not just a 200.
    const calls = h.calls.filter((c) => c.service === 'decisions' && c.method === 'answer');
    expect(calls).toHaveLength(answerCalls);
    expect(calls.at(-1)?.args[2]).toMatchObject({ relayFromMessageId: 'msg_1' });
    await client.close();
  });

  it('requires the message on a human-owned card and refuses a relay on the weaver\'s own (VS-310)', async () => {
    const { client, h } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null, agentId: 'ag_conductor' });
    const weaver = { kind: 'agent', id: 'ag_conductor' } as never;
    const text = (res: { content: unknown }) => JSON.parse((res.content as Array<{ text: string }>)[0]!.text);

    const humanCard = h.runtime.services.decisions.create(weaver, { kind: 'question', title: 'q', owner: 'human' });
    const missing = await client.callTool({ name: 'weave_decision_answer', arguments: { id: humanCard.id, text: 'no message' } });
    expect(text(missing).error.code).toBe('validation');

    const mine = h.runtime.services.decisions.create(weaver, { kind: 'question', title: 'mine', owner: 'weaver' });
    const relayed = await client.callTool({ name: 'weave_decision_answer', arguments: { id: mine.id, text: 'x', relayMessageId: 'msg_1' } });
    expect(text(relayed).error.code).toBe('validation');
    await client.close();
  });


  it('reads a scout report on another ticket in the worker\'s own project', async () => {
    const { client, h } = await connect();
    h.tickets.set('tk_scout', { ...h.tickets.get('tk_1')!, id: 'tk_scout', identifier: 'ACME-24', kind: 'scout', parentId: null });
    h.documents.set('tk_scout\0report', ['draft', 'the finding']);
    const res = await client.callTool({ name: 'weave_ticket_document_get', arguments: { id: 'ACME-24' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({ identifier: 'ACME-24', key: 'report', revision: 2, body: 'the finding' });
    await client.close();
  });

  it('reads an earlier revision when asked for one', async () => {
    const { client, h } = await connect();
    h.documents.set('tk_1\0plan', ['v1', 'v2']);
    const res = await client.callTool({ name: 'weave_ticket_document_get', arguments: { id: 'ACME-42', key: 'plan', revision: 1 } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.data).toMatchObject({ revision: 1, body: 'v1' });
    await client.close();
  });

  it('refuses a document on a ticket in another project', async () => {
    const { client, h } = await connect();
    h.tickets.set('tk_other', { ...h.tickets.get('tk_1')!, id: 'tk_other', identifier: 'ZED-7', projectId: 'proj2', parentId: null });
    h.documents.set('tk_other\0report', ['not for you']);
    const res = await client.callTool({ name: 'weave_ticket_document_get', arguments: { id: 'ZED-7' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('forbidden');
    await client.close();
  });

  it('lets the conductor read a document in any project', async () => {
    const { client, h } = await connect({ ...WORKER, agentKind: 'weaver', projectId: null, ticketId: null });
    h.tickets.set('tk_other', { ...h.tickets.get('tk_1')!, id: 'tk_other', identifier: 'ZED-7', projectId: 'proj2', parentId: null });
    h.documents.set('tk_other\0report', ['cross-project finding']);
    const res = await client.callTool({ name: 'weave_ticket_document_get', arguments: { id: 'ZED-7' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data.body).toBe('cross-project finding');
    await client.close();
  });

  it('names the documents a ticket does have when the key is unknown', async () => {
    const { client, h } = await connect();
    h.documents.set('tk_1\0plan', ['the plan']);
    const res = await client.callTool({ name: 'weave_ticket_document_get', arguments: { id: 'ACME-42', key: 'report' } });
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
    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/agent/tools/weave_ticket_comment', {
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
    expect(tools.map((t: { name: string }) => t.name)).toContain('weave_worktree_status');
    expect(tools[0].inputSchema.type).toBe('object');
  });

  it('lists and runs a plugin tool over the CLI REST mirror too, not only MCP (VS-334)', async () => {
    harness = makeHarness({ listener: 'loopback' });
    harness.runtime.ctx.plugins.tools.push({
      name: 'demo_greet', description: 'says hi', inputSchema: { type: 'object', properties: {} }, scope: 'all',
      handler: async () => ({ greeting: 'hi' }),
    });
    const app = createApp(harness.deps);
    const token = await signRunToken(runTokenSecret(harness.runtime.ctx.db), WORKER);
    const list = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/agent/tools', { headers: { authorization: `Bearer ${token}` } }));
    expect((await list.json()).map((t: { name: string }) => t.name)).toContain('demo_greet');

    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/agent/tools/demo_greet', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toEqual({ ok: true, data: { greeting: 'hi' } });
  });
  // ---------- VS-92 ----------

  it('forwards weave_ask inputs and defaults the project to the asker\'s own', async () => {
    const { client, h } = await connect();
    const res = await client.callTool({
      name: 'weave_ask',
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
    const { client, h } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null, projectId: null });
    await client.callTool({ name: 'weave_ask', arguments: { title: 'Which region?', projectId: 'proj9' } });
    expect(h.decisionInputs.at(-1)).toMatchObject({ projectId: 'proj9' });
    await client.close();
  });

  it('says on weave_ask that a secret input is stored rather than answered', async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools;
    const ask = tools.find((t) => t.name === 'weave_ask')!;
    expect(ask.description).toContain('never ask for one in prose');
    expect(ask.description).toContain('answerInputs');
    await client.close();
  });

  it('gives only the conductor weave_role_set_secrets, and refuses an unregistered name', async () => {
    const worker = await connect();
    expect((await worker.client.listTools()).tools.map((t) => t.name)).not.toContain('weave_role_set_secrets');
    await worker.client.close();

    const { client, h } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null });
    const refused = await client.callTool({ name: 'weave_role_set_secrets', arguments: { id: 'role_1', names: ['NOPE'], reason: 'needs it' } });
    expect(JSON.parse((refused.content as Array<{ text: string }>)[0]!.text).ok).toBe(false);
    expect(h.roleSecrets.size).toBe(0);

    // Registered by a human answering a secret input; only then can a role list it.
    h.runtime.services.secrets.put({ kind: 'human', id: 'victor' }, { name: 'CF_READONLY_TOKEN' }, 'cf-not-a-real-token-0000000000');
    const ok = await client.callTool({ name: 'weave_role_set_secrets', arguments: { id: 'role_1', names: ['CF_READONLY_TOKEN'], reason: 'cloudflare work' } });
    expect(JSON.parse((ok.content as Array<{ text: string }>)[0]!.text).ok).toBe(true);
    expect(h.roleSecrets.get('role_1')).toEqual(['CF_READONLY_TOKEN']);
    await client.close();
  });

  // ---------- VS-103 ----------

  it('weave_worker_message defaults to live delivery when the conductor omits `live`', async () => {
    const { client, h } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null });
    const calledWith: unknown[][] = [];
    h.impls.workers!['message'] = async (...args: unknown[]) => {
      calledWith.push(args);
      return { delivery: 'mid_turn', runId: 'run_1', wake: null };
    };
    const res = await client.callTool({ name: 'weave_worker_message', arguments: { workerId: 'ag_1', message: 'scope changed' } });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload).toEqual({ ok: true, data: { delivery: 'mid_turn', runId: 'run_1', wake: null } });
    expect(calledWith[0]![3]).toEqual({ live: true });
    await client.close();
  });

  it('weave_worker_message queues on request even when the caller could have asked for live delivery', async () => {
    const { client, h } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null });
    const calledWith: unknown[][] = [];
    h.impls.workers!['message'] = async (...args: unknown[]) => {
      calledWith.push(args);
      return { delivery: 'queued', runId: null, wake: { id: 'wk_9' } };
    };
    const res = await client.callTool({ name: 'weave_worker_message', arguments: { workerId: 'ag_1', message: 'later is fine', live: false } });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.data.delivery).toBe('queued');
    expect(calledWith[0]![3]).toEqual({ live: false });
    await client.close();
  });

  // ---------- VS-101 ----------

  it('weave_worker_message surfaces the refusal when the ticket is an interactive session', async () => {
    const { client, h } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null });
    h.impls.workers!['message'] = async () => {
      throw new OcError('forbidden', "Session #1's ticket is an interactive session; the conductor cannot message it directly");
    };
    const res = await client.callTool({ name: 'weave_worker_message', arguments: { workerId: 'ag_1', message: 'what are you doing' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('forbidden');
    await client.close();
  });

  // ---------- VS-106 ----------

  it('weave_worker_message surfaces wrong_status rather than ok:true for a retired worker', async () => {
    const { client, h } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null });
    h.impls.workers!['message'] = async () => {
      throw new OcError('wrong_status', 'Backend Engineer #1 has retired; reply on the ticket to reopen it instead');
    };
    const res = await client.callTool({ name: 'weave_worker_message', arguments: { workerId: 'ag_1', message: 'still there?' } });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('wrong_status');
    await client.close();
  });
});

// ---------- VS-133 ----------

describe('weave_inbox delivers attachment content, not just a reference', () => {
  it('turns an image attachment into a real MCP image content block, alongside the JSON summary', async () => {
    const { client, h } = await connect();
    h.impls.wake!['listForAgent'] = () => [wakeup({ payload: { threadId: 'th_1', attachmentIds: ['att_img'] } })];
    h.impls.threads!['attachment'] = (threadId: string, id: string) => {
      expect([threadId, id]).toEqual(['th_1', 'att_img']);
      return { attachment: { id: 'att_img', threadId: 'th_1', messageId: 'msg_1', filename: 'shot.png', mediaType: 'image/png', byteSize: 3, storageKey: 'x.png', createdAt: '2026-09-08T00:00:00.000Z' }, bytes: Buffer.from([1, 2, 3]) };
    };

    const res = await client.callTool({ name: 'weave_inbox', arguments: {} });
    expect(res.isError).toBeFalsy();
    const blocks = res.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    expect(blocks[0]!.type).toBe('text');
    const payload = JSON.parse(blocks[0]!.text!);
    expect(payload.data.messages[0].attachments).toEqual([{ id: 'att_img', filename: 'shot.png', mediaType: 'image/png', byteSize: 3 }]);
    const image = blocks.find((b) => b.type === 'image');
    expect(image).toEqual({ type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/png' });
    await client.close();
  });

  it('inlines a text attachment\'s content directly, with no separate image block', async () => {
    const { client, h } = await connect();
    h.impls.wake!['listForAgent'] = () => [wakeup({ payload: { threadId: 'th_1', attachmentIds: ['att_txt'] } })];
    h.impls.threads!['attachment'] = () => ({
      attachment: { id: 'att_txt', threadId: 'th_1', messageId: 'msg_1', filename: 'notes.txt', mediaType: 'text/plain', byteSize: 11, storageKey: 'x.txt', createdAt: '2026-09-08T00:00:00.000Z' },
      bytes: Buffer.from('do the thing'),
    });

    const res = await client.callTool({ name: 'weave_inbox', arguments: {} });
    const blocks = res.content as Array<{ type: string; text?: string }>;
    expect(blocks).toHaveLength(1); // no image block for a text attachment
    const payload = JSON.parse(blocks[0]!.text!);
    expect(payload.data.messages[0].attachments).toEqual([{ id: 'att_txt', filename: 'notes.txt', mediaType: 'text/plain', byteSize: 11, text: 'do the thing' }]);
    await client.close();
  });

  it('produces exactly the one text block when nothing has an attachment (no regression)', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'weave_inbox', arguments: {} });
    expect(res.content).toHaveLength(1);
    expect((res.content as Array<{ type: string }>)[0]!.type).toBe('text');
    await client.close();
  });

  it('drops a deleted/unreadable attachment rather than failing the whole call', async () => {
    const { client, h } = await connect();
    h.impls.wake!['listForAgent'] = () => [wakeup({ payload: { threadId: 'th_1', attachmentIds: ['att_gone'] } })];
    h.impls.threads!['attachment'] = () => { throw new OcError('not_found', 'attachment att_gone not found in thread th_1'); };

    const res = await client.callTool({ name: 'weave_inbox', arguments: {} });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data.messages[0].attachments).toEqual([]);
    await client.close();
  });

  it('weave_ticket_list omits description by default (VS-161)', async () => {
    const { client, h } = await connect();
    h.tickets.set('tk_1', { ...h.tickets.get('tk_1')!, description: 'a long body that must not list' });

    const listed = JSON.parse(((await client.callTool({ name: 'weave_ticket_list', arguments: {} })).content as Array<{ text: string }>)[0]!.text);
    expect(listed.ok).toBe(true);
    expect(listed.data.items[0]).toMatchObject({ id: 'tk_1', identifier: 'ACME-42', status: 'in_progress', kind: 'change', title: 'Add dark mode' });
    expect(listed.data.items[0]).not.toHaveProperty('description');

    const fat = JSON.parse(((await client.callTool({ name: 'weave_ticket_list', arguments: { includeDescription: true } })).content as Array<{ text: string }>)[0]!.text);
    expect(fat.data.items[0].description).toBe('a long body that must not list');

    const got = JSON.parse(((await client.callTool({ name: 'weave_ticket_get', arguments: { id: 'ACME-42' } })).content as Array<{ text: string }>)[0]!.text);
    expect(got.data.ticket.description).toBe('a long body that must not list');
    await client.close();
  });

  it('does not cap weave_ticket_get when the description exceeds the list cap (VS-161)', async () => {
    const { client, h } = await connect();
    const huge = 'x'.repeat(MCP_LIST_RESULT_CAP + 1024);
    h.tickets.set('tk_1', { ...h.tickets.get('tk_1')!, description: huge });
    const res = await client.callTool({ name: 'weave_ticket_get', arguments: { id: 'ACME-42' } });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text.length).toBeGreaterThan(MCP_LIST_RESULT_CAP);
    const payload = JSON.parse(text);
    expect(payload.data.ticket.description).toBe(huge);
    expect(payload.data.truncated).toBeUndefined();
    await client.close();
  });
});

describe('MCP list-result cap (VS-161)', () => {
  it('marks an oversized list truncated and stays under the cap', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, description: 'y'.repeat(3000) }));
    const fat = ok({ items, total: items.length });
    expect(JSON.stringify(fat).length).toBeGreaterThan(MCP_LIST_RESULT_CAP);
    const capped = capListResult(fat, MCP_LIST_RESULT_CAP);
    const text = JSON.stringify(capped);
    expect(text.length).toBeLessThanOrEqual(MCP_LIST_RESULT_CAP);
    expect(capped.ok).toBe(true);
    if (capped.ok) {
      const data = capped.data as { items: unknown[]; truncated: boolean; total: number };
      expect(data.truncated).toBe(true);
      expect(data.items.length).toBeLessThan(items.length);
      expect(data.total).toBe(items.length);
    }
  });

  it('does not cap a get-by-id encode', () => {
    const huge = ok({ ticket: { description: 'z'.repeat(MCP_LIST_RESULT_CAP + 100) } });
    const text = encodeMcpToolResult('weave_ticket_get', huge);
    expect(text.length).toBeGreaterThan(MCP_LIST_RESULT_CAP);
    expect(text).not.toContain('"truncated":true');
  });
});

describe('scheduled task MCP (VS-220)', () => {
  const TRIGGER = { kind: 'schedule', timezone: 'UTC', everyMinutes: 15 };
  const CREATE = { name: 'Morning review', trigger: TRIGGER, instruction: 'Look at incidents' };

  it('lets the conductor create a row', async () => {
    const { client } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null });
    const res = await client.callTool({ name: 'weave_routine_create', arguments: CREATE });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({ name: 'Morning review', template: { action: 'report', instruction: 'Look at incidents' } });
    const listed = await client.callTool({ name: 'weave_routine_list', arguments: {} });
    const list = JSON.parse((listed.content as Array<{ text: string }>)[0]!.text);
    expect(list.data.items).toHaveLength(1);
    await client.close();
  });

  it('rejects a worker call with no row stored', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'weave_routine_create', arguments: CREATE });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('forbidden');
    expect(harness!.runtime.services.routines.list()).toEqual([]);
    await client.close();
  });

  it('weave_inbox lists a routine fire under routines, not other', async () => {
    const { client, h } = await connect({ ...WORKER, agentKind: 'weaver', ticketId: null });
    h.impls.wake!['listForAgent'] = () => [wakeup({
      id: 'wk_1',
      source: 'routine',
      reason: 'scheduled task: Morning review',
      payload: { routineId: 'rt_1', name: 'Morning review', instruction: 'Look at incidents', action: 'report' },
    })];
    const res = await client.callTool({ name: 'weave_inbox', arguments: {} });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(payload.data.routines).toEqual([expect.objectContaining({
      source: 'routine',
      payload: expect.objectContaining({ instruction: 'Look at incidents' }),
    })]);
    expect(payload.data.other ?? []).not.toEqual(expect.arrayContaining([expect.objectContaining({ source: 'routine' })]));
    await client.close();
  });
});
