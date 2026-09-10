import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
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
