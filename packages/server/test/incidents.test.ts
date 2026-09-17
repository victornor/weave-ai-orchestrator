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
const CONDUCTOR: RunTokenClaims = { ...WORKER, agentKind: 'weaver', ticketId: null };

const FILE = {
  title: 'MCP call failed',
  whatFailed: 'weave_ticket_get returned not_found',
  tryingToDo: 'read the bound ticket',
  evidence: 'OcError not_found',
};

async function fileViaAgent(h: Harness, claims: RunTokenClaims, input: Record<string, unknown>) {
  const app = createApp(h.deps);
  const token = await signRunToken(runTokenSecret(h.runtime.ctx.db), claims);
  return app.fetch(new Request(`http://127.0.0.1/api/w/${claims.workspaceId}/agent/tools/weave_incident`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  }));
}

describe('weave_incident', () => {
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
    expect(payload.data.reporterKind).toBe('weaver');
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

  it('filters reporter=weaver', async () => {
    harness = makeHarness({ listener: 'loopback' });
    await fileViaAgent(harness, WORKER, { ...FILE, title: 'worker one' });
    await fileViaAgent(harness, CONDUCTOR, { ...FILE, title: 'conductor one' });
    const app = createApp(harness.deps);
    const res = await app.fetch(new Request('http://127.0.0.1/api/incidents?reporter=weaver', { headers: authed() }));
    const body = await res.json() as { items: Array<{ title: string }> };
    expect(body.items.map((i) => i.title)).toEqual(['conductor one']);
  });

  it('keeps listing a resolved incident (VS-271): the tool-level open default does not leak here', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const filed = await fileViaAgent(harness, WORKER, { ...FILE, title: 'will be resolved' });
    const { data } = await filed.json() as { data: { id: string } };
    harness.deps.incidents.resolve(data.id, { resolution: 'dealt with', resolvedByAgentId: 'ag_conductor' });
    const app = createApp(harness.deps);
    const res = await app.fetch(new Request('http://127.0.0.1/api/incidents', { headers: authed() }));
    const body = await res.json() as { items: Array<{ title: string; resolvedAt: string | null }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ title: 'will be resolved' });
    expect(body.items[0]?.resolvedAt).not.toBeNull();
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

describe('weave_incident_list / weave_incident_get (VS-222)', () => {
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
    for (const tool of ['weave_incident_list', 'weave_incident_get']) {
      const res = await callTool(harness, WORKER, tool, tool === 'weave_incident_get' ? { id: 'inc_any' } : {});
      const body = (await res.json()) as ToolEnvelope;
      expect(res.status).toBe(403);
      expect(body.ok === false || body.ok === undefined).toBe(true);
      expect(body.error?.code).toBe('forbidden');
    }
    expect(harness.deps.incidents.list().total).toBe(1);
  });

  it('lists incidents from every workspace, workspace-less rows included (VS-499)', async () => {
    harness = makeHarness({ listener: 'loopback' });
    await fileViaAgent(harness, CONDUCTOR, { ...FILE, title: 'alpha conductor' });
    await fileViaAgent(harness, WORKER, { ...FILE, title: 'alpha worker' });
    harness.deps.incidents.create({
      reporterKind: 'weaver', title: 'daemon-global', whatFailed: 'x', tryingToDo: 'y',
      agentId: 'ag_0', runId: 'run_0', workspaceId: null,
    });
    const beta = harness.deps.incidents.create({
      reporterKind: 'worker', title: 'beta worker', whatFailed: 'x', tryingToDo: 'y',
      agentId: 'ag_2', runId: 'run_2', workspaceId: 'ws2',
    });
    expect(beta.workspaceId).toBe('ws2');

    const body = (await (await callTool(harness, CONDUCTOR, 'weave_incident_list', {})).json()) as {
      ok: boolean; data: { items: Array<{ title: string }>; total: number };
    };
    expect(body.ok).toBe(true);
    // Another workspace's incident is now in the result; nothing is silently scoped away.
    expect([...body.data.items.map((i) => i.title)].sort()).toEqual(['alpha conductor', 'alpha worker', 'beta worker', 'daemon-global']);
    expect(body.data.total).toBe(4);

    // Narrowing is exact: only the named workspace's rows, never the workspace-less one.
    const narrow = (await (await callTool(harness, CONDUCTOR, 'weave_incident_list', { workspaceId: 'ws2' })).json()) as {
      data: { items: Array<{ title: string }>; total: number };
    };
    expect(narrow.data.items.map((i) => i.title)).toEqual(['beta worker']);
    expect(narrow.data.total).toBe(1);
  });

  it('returns a lean list by default and the full row on get', async () => {
    harness = makeHarness({ listener: 'loopback' });
    await fileViaAgent(harness, WORKER, FILE);

    const lean = (await (await callTool(harness, CONDUCTOR, 'weave_incident_list', {})).json()) as {
      ok: boolean; data: { items: Array<Record<string, unknown>> };
    };
    expect(lean.ok).toBe(true);
    expect(lean.data.items).toHaveLength(1);
    expect(lean.data.items[0]).not.toHaveProperty('evidence');

    const withEvidence = (await (await callTool(harness, CONDUCTOR, 'weave_incident_list', { includeEvidence: true })).json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(withEvidence.data.items[0]).toHaveProperty('evidence', FILE.evidence);

    const id = (lean.data.items[0] as { id: string }).id;
    const got = (await (await callTool(harness, CONDUCTOR, 'weave_incident_get', { id })).json()) as {
      ok: boolean; data: { title: string; evidence: string | null; reporterKind: string };
    };
    expect(got.ok).toBe(true);
    expect(got.data).toMatchObject({ title: FILE.title, evidence: FILE.evidence, reporterKind: 'worker' });
  });

  it('get: reads any workspace\'s incident, not_found for an unknown id (VS-499)', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const beta = harness.deps.incidents.create({
      reporterKind: 'worker', title: 'beta worker', whatFailed: 'x', tryingToDo: 'y',
      agentId: 'ag_2', runId: 'run_2', workspaceId: 'ws2',
    });

    const unknown = (await (await callTool(harness, CONDUCTOR, 'weave_incident_get', { id: 'inc_nope' })).json()) as ToolEnvelope;
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe('not_found');

    // No `forbidden`: another workspace's incident reads like any other.
    const cross = (await (await callTool(harness, CONDUCTOR, 'weave_incident_get', { id: beta.id })).json()) as {
      ok: boolean; data: { title: string; workspaceId: string };
    };
    expect(cross.ok).toBe(true);
    expect(cross.data).toMatchObject({ title: 'beta worker', workspaceId: 'ws2' });
  });

  it('passes since through: past bound returns all, future bound none, unparseable is validation', async () => {
    harness = makeHarness({ listener: 'loopback' });
    await fileViaAgent(harness, CONDUCTOR, FILE);

    const all = (await (await callTool(harness, CONDUCTOR, 'weave_incident_list', { since: '2000-01-01T00:00:00Z' })).json()) as { data: { total: number } };
    expect(all.data.total).toBe(1);
    const none = (await (await callTool(harness, CONDUCTOR, 'weave_incident_list', { since: '2099-01-01T00:00:00Z' })).json()) as { data: { items: unknown[]; total: number } };
    expect(none.data.items).toEqual([]);
    expect(none.data.total).toBe(0);
    const bad = (await (await callTool(harness, CONDUCTOR, 'weave_incident_list', { since: 'yesterday' })).json()) as ToolEnvelope;
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('validation');
  });

  it('caps weave_incident_list at the MCP list limit and never caps the get', () => {
    const bigRow = { id: 'inc_big', title: 'x'.repeat(70_000) };
    const capped = JSON.parse(encodeMcpToolResult('weave_incident_list', { ok: true, data: { items: [bigRow], total: 1 } }));
    expect(capped.data.truncated).toBe(true);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(64 * 1024);

    const got = JSON.parse(encodeMcpToolResult('weave_incident_get', { ok: true, data: bigRow }));
    expect(got.data.title).toBe(bigRow.title);
    expect(JSON.stringify(got).length).toBeGreaterThan(64 * 1024);
  });
});

describe('weave_incident_resolve (VS-271)', () => {
  async function callTool(h: Harness, claims: RunTokenClaims, tool: string, input: Record<string, unknown>) {
    const app = createApp(h.deps);
    const token = await signRunToken(runTokenSecret(h.runtime.ctx.db), claims);
    return app.fetch(new Request(`http://127.0.0.1/api/w/${claims.workspaceId}/agent/tools/${tool}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
    }));
  }

  it('a conductor resolves an incident, and it round-trips through weave_incident_get', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const filed = await fileViaAgent(harness, WORKER, FILE);
    const { data } = await filed.json() as { data: { id: string } };

    const res = await callTool(harness, CONDUCTOR, 'weave_incident_resolve', { id: data.id, resolution: 'fixed by VS-232', ticketId: 'VS-232' });
    const payload = await res.json() as { ok: boolean; data: { resolvedAt: string | null; resolvedByAgentId: string; resolvedByWorkspaceId: string | null; resolution: string; resolutionTicketId: string } };
    expect(payload.ok).toBe(true);
    expect(payload.data.resolvedAt).not.toBeNull();
    expect(payload.data.resolvedByAgentId).toBe(CONDUCTOR.agentId);
    expect(payload.data.resolvedByWorkspaceId).toBe(CONDUCTOR.workspaceId);
    expect(payload.data.resolution).toBe('fixed by VS-232');
    expect(payload.data.resolutionTicketId).toBe('VS-232');

    const got = (await (await callTool(harness, CONDUCTOR, 'weave_incident_get', { id: data.id })).json()) as {
      data: { resolvedAt: string | null; resolution: string };
    };
    expect(got.data.resolvedAt).toBe(payload.data.resolvedAt);
    expect(got.data.resolution).toBe('fixed by VS-232');
  });

  it('stores ticketId as given even when no such ticket exists', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const filed = await fileViaAgent(harness, WORKER, FILE);
    const { data } = await filed.json() as { data: { id: string } };
    const res = await callTool(harness, CONDUCTOR, 'weave_incident_resolve', { id: data.id, resolution: 'x', ticketId: 'NOPE-999' });
    const payload = await res.json() as { data: { resolutionTicketId: string } };
    expect(payload.data.resolutionTicketId).toBe('NOPE-999');
  });

  it('rejects a worker with forbidden, and the incident stays unresolved', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const filed = await fileViaAgent(harness, WORKER, FILE);
    const { data } = await filed.json() as { data: { id: string } };
    const res = await callTool(harness, WORKER, 'weave_incident_resolve', { id: data.id, resolution: 'x' });
    const payload = await res.json() as ToolEnvelope;
    expect(res.status).toBe(403);
    expect(payload.error?.code).toBe('forbidden');
    expect(harness.deps.incidents.get(data.id).resolvedAt).toBeNull();
  });

  it('rejects re-resolving with wrong_status and leaves the original resolution intact', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const filed = await fileViaAgent(harness, WORKER, FILE);
    const { data } = await filed.json() as { data: { id: string } };
    await callTool(harness, CONDUCTOR, 'weave_incident_resolve', { id: data.id, resolution: 'first' });
    const res = await callTool(harness, CONDUCTOR, 'weave_incident_resolve', { id: data.id, resolution: 'second' });
    const payload = await res.json() as ToolEnvelope;
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe('wrong_status');
    expect(harness.deps.incidents.get(data.id).resolution).toBe('first');
  });

  it('resolve: closes any workspace\'s incident, keeping filing and resolving workspaces distinct (VS-499)', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const beta = harness.deps.incidents.create({
      reporterKind: 'worker', title: 'beta worker', whatFailed: 'x', tryingToDo: 'y',
      agentId: 'ag_2', runId: 'run_2', workspaceId: 'ws2',
    });

    const unknown = (await (await callTool(harness, CONDUCTOR, 'weave_incident_resolve', { id: 'inc_nope', resolution: 'x' })).json()) as ToolEnvelope;
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe('not_found');

    const cross = (await (await callTool(harness, CONDUCTOR, 'weave_incident_resolve', { id: beta.id, resolution: 'fixed cross-workspace' })).json()) as {
      ok: boolean; data: { workspaceId: string; resolvedByWorkspaceId: string | null };
    };
    expect(cross.ok).toBe(true);
    expect(cross.data).toMatchObject({ workspaceId: 'ws2', resolvedByWorkspaceId: CONDUCTOR.workspaceId });
    const stored = harness.deps.incidents.get(beta.id);
    expect(stored.workspaceId).toBe('ws2');
    expect(stored.resolvedByWorkspaceId).toBe('ws1');
    expect(stored.resolvedAt).not.toBeNull();
  });

  it('a second sweep finds nothing new: list, resolve everything found, list again', async () => {
    harness = makeHarness({ listener: 'loopback' });
    await fileViaAgent(harness, WORKER, { ...FILE, title: 'one' });
    await fileViaAgent(harness, WORKER, { ...FILE, title: 'two' });

    const first = (await (await callTool(harness, CONDUCTOR, 'weave_incident_list', {})).json()) as {
      data: { items: Array<{ id: string }> };
    };
    expect(first.data.items).toHaveLength(2);
    for (const item of first.data.items) {
      await callTool(harness, CONDUCTOR, 'weave_incident_resolve', { id: item.id, resolution: 'swept' });
    }

    const second = (await (await callTool(harness, CONDUCTOR, 'weave_incident_list', {})).json()) as {
      data: { items: unknown[]; total: number };
    };
    expect(second.data.items).toEqual([]);
    expect(second.data.total).toBe(0);

    // status: 'all' still shows them.
    const all = (await (await callTool(harness, CONDUCTOR, 'weave_incident_list', { status: 'all' })).json()) as {
      data: { items: unknown[]; total: number };
    };
    expect(all.data.total).toBe(2);
  });
});
