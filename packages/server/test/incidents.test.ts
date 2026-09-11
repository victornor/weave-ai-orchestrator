import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { encodeMcpToolResult } from '../src/mcp.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const WORKER: RunTokenClaims = {
  workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker',
  projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1',
};
const CONDUCTOR: RunTokenClaims = { ...WORKER, agentKind: 'conductor', ticketId: null };

const FILE = {
  title: 'MCP call failed',
  whatFailed: 'ac_ticket_get returned not_found',
  tryingToDo: 'read the bound ticket',
  evidence: 'OcError not_found',
};

async function fileViaAgent(h: Harness, claims: RunTokenClaims, input: Record<string, unknown>) {
  const app = createApp(h.deps);
  const token = await signRunToken(runTokenSecret(h.runtime.ctx.db), claims);
  return app.fetch(new Request(`http://127.0.0.1/api/w/${claims.workspaceId}/agent/tools/ac_incident`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  }));
}

describe('ac_incident', () => {
  it('lets a worker file, storing reporterKind worker and run context', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const res = await fileViaAgent(harness, WORKER, FILE);
    expect(res.status).toBe(200);
    const payload = await res.json() as { ok: boolean; data: { id: string; reporterKind: string } };
    expect(payload.ok).toBe(true);
    expect(payload.data.reporterKind).toBe('worker');
    const row = harness.deps.incidents.get(payload.data.id);
    expect(row).toMatchObject({
      reporterKind: 'worker', title: FILE.title, workspaceId: 'ws1',
      agentId: 'ag_1', runId: 'run_1', ticketId: 'tk_1', projectId: 'proj1',
    });
  });

  it('lets a conductor file as conductor', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const res = await fileViaAgent(harness, CONDUCTOR, FILE);
    const payload = await res.json() as { ok: boolean; data: { reporterKind: string } };
    expect(payload.ok).toBe(true);
    expect(payload.data.reporterKind).toBe('conductor');
  });

  it('rejects an empty title with validation and stores nothing', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const res = await fileViaAgent(harness, WORKER, { ...FILE, title: '' });
    const payload = await res.json() as { ok: boolean; error: { code: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('validation');
    expect(harness.deps.incidents.list().total).toBe(0);
  });

  it('does not create a ticket, a decision, or a thread message', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const tickets = harness.tickets.size;
    const decisions = harness.decisionInputs.length;
    const comments = harness.comments.length;
    await fileViaAgent(harness, WORKER, FILE);
    expect(harness.tickets.size).toBe(tickets);
    expect(harness.decisionInputs.length).toBe(decisions);
    expect(harness.comments.length).toBe(comments);
    expect(harness.deps.incidents.list().total).toBe(1);
  });
});

describe('GET /api/incidents', () => {
  it('lists session-authenticated incidents newest first across reporter kinds', async () => {
    harness = makeHarness({ listener: 'loopback' });
    await fileViaAgent(harness, WORKER, { ...FILE, title: 'worker one' });
    await fileViaAgent(harness, CONDUCTOR, { ...FILE, title: 'conductor one' });
    const app = createApp(harness.deps);
    const res = await app.fetch(new Request('http://127.0.0.1/api/incidents', { headers: authed() }));
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ title: string; reporterKind: string }>; total: number };
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.title)).toEqual(['conductor one', 'worker one']);
  });

  it('filters reporter=conductor', async () => {
    harness = makeHarness({ listener: 'loopback' });
    await fileViaAgent(harness, WORKER, { ...FILE, title: 'worker one' });
    await fileViaAgent(harness, CONDUCTOR, { ...FILE, title: 'conductor one' });
    const app = createApp(harness.deps);
    const res = await app.fetch(new Request('http://127.0.0.1/api/incidents?reporter=conductor', { headers: authed() }));
    const body = await res.json() as { items: Array<{ title: string }> };
    expect(body.items.map((i) => i.title)).toEqual(['conductor one']);
  });

  it('rejects a run token', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const app = createApp(harness.deps);
    const token = await signRunToken(runTokenSecret(harness.runtime.ctx.db), WORKER);
    const res = await app.fetch(new Request('http://127.0.0.1/api/incidents', {
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(res.status).toBe(403);
  });
});

type ToolEnvelope = { ok: boolean; data?: Record<string, unknown>; error?: { code: string } };

describe('ac_incident_list / ac_incident_get (VS-222)', () => {
  async function callTool(h: Harness, claims: RunTokenClaims, tool: string, input: Record<string, unknown>) {
    const app = createApp(h.deps);
    const token = await signRunToken(runTokenSecret(h.runtime.ctx.db), claims);
    return app.fetch(new Request(`http://127.0.0.1/api/w/${claims.workspaceId}/agent/tools/${tool}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
    }));
  }

  it('rejects a worker for both read tools while filing keeps working', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const filed = await fileViaAgent(harness, WORKER, FILE);
    expect(((await filed.json()) as { ok: boolean }).ok).toBe(true);
    for (const tool of ['ac_incident_list', 'ac_incident_get']) {
      const res = await callTool(harness, WORKER, tool, tool === 'ac_incident_get' ? { id: 'inc_any' } : {});
      const body = (await res.json()) as ToolEnvelope;
      expect(res.status).toBe(403);
      expect(body.ok === false || body.ok === undefined).toBe(true);
      expect(body.error?.code).toBe('forbidden');
    }
    expect(harness.deps.incidents.list().total).toBe(1);
  });

  it('lists the conductor workspace plus workspace-less rows, never another workspace', async () => {
    harness = makeHarness({ listener: 'loopback' });
    await fileViaAgent(harness, CONDUCTOR, { ...FILE, title: 'alpha conductor' });
    await fileViaAgent(harness, WORKER, { ...FILE, title: 'alpha worker' });
    harness.deps.incidents.create({
      reporterKind: 'conductor', title: 'daemon-global', whatFailed: 'x', tryingToDo: 'y',
      agentId: 'ag_0', runId: 'run_0', workspaceId: null,
    });
    const beta = harness.deps.incidents.create({
      reporterKind: 'worker', title: 'beta worker', whatFailed: 'x', tryingToDo: 'y',
      agentId: 'ag_2', runId: 'run_2', workspaceId: 'ws2',
    });
    expect(beta.workspaceId).toBe('ws2');

    const body = (await (await callTool(harness, CONDUCTOR, 'ac_incident_list', {})).json()) as {
      ok: boolean; data: { items: Array<{ title: string }>; total: number };
    };
    expect(body.ok).toBe(true);
    const titles = body.data.items.map((i) => i.title);
    expect(titles).not.toContain('beta worker');
    expect([...titles].sort()).toEqual(['alpha conductor', 'alpha worker', 'daemon-global']);
    expect(body.data.total).toBe(3);
  });

  it('returns a lean list by default and the full row on get', async () => {
    harness = makeHarness({ listener: 'loopback' });
    await fileViaAgent(harness, WORKER, FILE);

    const lean = (await (await callTool(harness, CONDUCTOR, 'ac_incident_list', {})).json()) as {
      ok: boolean; data: { items: Array<Record<string, unknown>> };
    };
    expect(lean.ok).toBe(true);
    expect(lean.data.items).toHaveLength(1);
    expect(lean.data.items[0]).not.toHaveProperty('evidence');

    const withEvidence = (await (await callTool(harness, CONDUCTOR, 'ac_incident_list', { includeEvidence: true })).json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(withEvidence.data.items[0]).toHaveProperty('evidence', FILE.evidence);

    const id = (lean.data.items[0] as { id: string }).id;
    const got = (await (await callTool(harness, CONDUCTOR, 'ac_incident_get', { id })).json()) as {
      ok: boolean; data: { title: string; evidence: string | null; reporterKind: string };
    };
    expect(got.ok).toBe(true);
    expect(got.data).toMatchObject({ title: FILE.title, evidence: FILE.evidence, reporterKind: 'worker' });
  });

  it('get: not_found for an unknown id, forbidden for another workspace', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const beta = harness.deps.incidents.create({
      reporterKind: 'worker', title: 'beta worker', whatFailed: 'x', tryingToDo: 'y',
      agentId: 'ag_2', runId: 'run_2', workspaceId: 'ws2',
    });

    const unknown = (await (await callTool(harness, CONDUCTOR, 'ac_incident_get', { id: 'inc_nope' })).json()) as ToolEnvelope;
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe('not_found');

    const cross = (await (await callTool(harness, CONDUCTOR, 'ac_incident_get', { id: beta.id })).json()) as ToolEnvelope;
    expect(cross.ok).toBe(false);
    expect(cross.error?.code).toBe('forbidden');
  });

  it('passes since through: past bound returns all, future bound none, unparseable is validation', async () => {
    harness = makeHarness({ listener: 'loopback' });
    await fileViaAgent(harness, CONDUCTOR, FILE);

    const all = (await (await callTool(harness, CONDUCTOR, 'ac_incident_list', { since: '2000-01-01T00:00:00Z' })).json()) as { data: { total: number } };
    expect(all.data.total).toBe(1);
    const none = (await (await callTool(harness, CONDUCTOR, 'ac_incident_list', { since: '2099-01-01T00:00:00Z' })).json()) as { data: { items: unknown[]; total: number } };
    expect(none.data.items).toEqual([]);
    expect(none.data.total).toBe(0);
    const bad = (await (await callTool(harness, CONDUCTOR, 'ac_incident_list', { since: 'yesterday' })).json()) as ToolEnvelope;
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('validation');
  });

  it('caps ac_incident_list at the MCP list limit and never caps the get', () => {
    const bigRow = { id: 'inc_big', title: 'x'.repeat(70_000) };
    const capped = JSON.parse(encodeMcpToolResult('ac_incident_list', { ok: true, data: { items: [bigRow], total: 1 } }));
    expect(capped.data.truncated).toBe(true);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(64 * 1024);

    const got = JSON.parse(encodeMcpToolResult('ac_incident_get', { ok: true, data: bigRow }));
    expect(got.data.title).toBe(bigRow.title);
    expect(JSON.stringify(got).length).toBeGreaterThan(64 * 1024);
  });
});
