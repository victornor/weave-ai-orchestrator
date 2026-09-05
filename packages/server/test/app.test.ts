import { describe, expect, it, afterEach } from 'vitest';
import { OcError } from '@agent-conductor/shared';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import { authed, makeHarness, ticket, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(() => { harness?.close(); harness = null; });

const app = (opts?: Parameters<typeof makeHarness>[0]) => {
  harness = makeHarness(opts);
  return { h: harness, fetch: (path: string, init?: RequestInit) => createApp(harness!.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
};

describe('auth gating', () => {
  it('lets health through unauthenticated', async () => {
    const { fetch } = app();
    const res = await fetch('/api/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, operatorConfigured: true, tlsMode: 'none' });
  });

  it('401s an unauthenticated API call', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/tickets');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthorized');
  });

  it('accepts a bearer session token', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/tickets', { headers: authed() });
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
  });

  it('accepts the ac_session cookie and enforces the Origin on mutations', async () => {
    const { fetch } = app();
    const ok = await fetch('/api/w/ws1/tickets', { headers: { cookie: 'ac_session=sess-token' } });
    expect(ok.status).toBe(200);

    const forged = await fetch('/api/w/ws1/tickets', {
      method: 'POST', headers: { cookie: 'ac_session=sess-token', origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'task', title: 'x' }),
    });
    expect(forged.status).toBe(403);
    expect((await forged.json()).error.code).toBe('forbidden');
  });

  it('bypasses auth for loopback peers when loopbackTrusted is set', async () => {
    harness = makeHarness();
    harness.deps.daemon.auth.loopbackTrusted = true;
    harness.deps.listener = 'loopback';
    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/tickets'));
    expect(res.status).toBe(200);
  });
});

describe('run tokens', () => {
  const token = async (h: Harness, over: Record<string, unknown> = {}) =>
    signRunToken(runTokenSecret(h.runtime.ctx.db), {
      workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1', ...over,
    } as never);

  it('are refused on the public listener', async () => {
    const { h, fetch } = app({ listener: 'public' });
    const res = await fetch('/api/w/ws1/agent/inbox', { headers: { authorization: `Bearer ${await token(h)}` } });
    expect(res.status).toBe(401);
  });

  it('are refused outside the agent surface', async () => {
    const { h, fetch } = app({ listener: 'loopback' });
    const res = await fetch('/api/w/ws1/tickets', { headers: { authorization: `Bearer ${await token(h)}` } });
    expect(res.status).toBe(403);
  });

  it('reach the agent surface on the loopback listener', async () => {
    const { h, fetch } = app({ listener: 'loopback' });
    const res = await fetch('/api/w/ws1/agent/inbox', { headers: { authorization: `Bearer ${await token(h)}` } });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.messages).toHaveLength(1);
    expect(payload.data.messages[0].source).toBe('human_message');
  });

  it('reject a tampered signature', async () => {
    const { h, fetch } = app({ listener: 'loopback' });
    const bad = (await token(h)).slice(0, -3) + 'aaa';
    const res = await fetch('/api/w/ws1/agent/inbox', { headers: { authorization: `Bearer ${bad}` } });
    expect(res.status).toBe(401);
  });
});

describe('error mapping', () => {
  it('maps OcError codes onto their status and envelope', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/tickets/nope', { headers: authed() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'ticket nope not found', details: undefined, retryable: false } });
  });

  it('maps zod failures onto 400 validation with issues', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/tickets', { method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'no kind' }) });
    expect(res.status).toBe(400);
    const err = (await res.json()).error;
    expect(err.code).toBe('validation');
    expect(err.details.issues[0].path).toBe('kind');
  });

  it('404s an unknown API path instead of serving the SPA', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/nothing-here', { headers: authed() });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('404s an unknown workspace', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/other/tickets', { headers: authed() });
    expect(res.status).toBe(404);
  });
});

describe('routes', () => {
  it('creates a ticket and emits an event', async () => {
    const { h, fetch } = app();
    const res = await fetch('/api/w/ws1/tickets', { method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ kind: 'task', title: 'Write tests' }) });
    expect(res.status).toBe(201);
    expect((await res.json()).title).toBe('Write tests');
    expect(h.bus.since(0).map((e) => e.type)).toContain('ticket.created');
  });

  it('opens a nested capability whether the client encodes the slash or not', async () => {
    const { h, fetch } = app();
    const seen: string[] = [];
    h.impls.specs!.getCapability = (_project: string, capability: string) => { seen.push(capability); return { capability, requirements: [], pending: [], history: [] }; };

    for (const path of ['/api/w/ws1/specs/proj1/capabilities/conductor-chat%2Fdispatch-labels', '/api/w/ws1/specs/proj1/capabilities/conductor-chat/dispatch-labels']) {
      const res = await fetch(path, { headers: authed() });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ capability: 'conductor-chat/dispatch-labels' });
    }
    expect(seen).toEqual(['conductor-chat/dispatch-labels', 'conductor-chat/dispatch-labels']);
  });

  it('patches one nested workspace default and leaves its siblings alone', async () => {
    const { h, fetch } = app();
    const saved: unknown[] = [];
    h.runtime.ctx.saveConfig = async (next) => { saved.push(next); h.runtime.ctx.config = next; };
    h.runtime.ctx.config.defaults.turnTimeoutSec = 900;

    const res = await fetch('/api/w/ws1/config', {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ defaults: { knowledgeBudgetTokens: { project: 25000 } } }),
    });
    expect(res.status).toBe(200);
    const config = await res.json();
    expect(config.defaults.knowledgeBudgetTokens).toMatchObject({ project: 25000, document: 10000, shared: 2000 });
    expect(config.defaults.turnTimeoutSec).toBe(900);
    expect(config.name).toBe('Test workspace');
    expect(saved).toHaveLength(1);
  });

  it('rejects a knowledge budget that is not a sane token count and saves nothing', async () => {
    const { h, fetch } = app();
    const saved: unknown[] = [];
    h.runtime.ctx.saveConfig = async (next) => { saved.push(next); };

    const res = await fetch('/api/w/ws1/config', {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ defaults: { knowledgeBudgetTokens: { project: 0 } } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
    expect(saved).toHaveLength(0);
    expect(h.runtime.ctx.config.defaults.knowledgeBudgetTokens.project).toBe(10000);
  });

  it("serves a project's merge queue with active and waiting tickets in order", async () => {
    const { h, fetch } = app();
    h.tickets.set('tk_1', ticket({ status: 'merging', mergeQueuedAt: '2026-09-01T10:00:00.000Z', mergeStartedAt: '2026-09-01T10:00:01.000Z' }));
    h.tickets.set('tk_2', ticket({ id: 'tk_2', identifier: 'ACME-43', title: 'Behind it', status: 'merging', mergeQueuedAt: '2026-09-01T11:00:00.000Z' }));

    const res = await fetch('/api/w/ws1/projects/proj1/merge-queue', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ projectId: 'proj1', concurrency: 1 });
    expect(body.active.map((e: { ticketId: string }) => e.ticketId)).toEqual(['tk_1']);
    expect(body.waiting).toEqual([expect.objectContaining({ ticketId: 'tk_2', identifier: 'ACME-43', position: 1 })]);
  });

  it('serves an empty merge queue for a project with nothing merging', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/projects/proj1/merge-queue', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ projectId: 'proj1', concurrency: 1, active: [], waiting: [] });
  });

  it("carries a waiting ticket's own merge queue position on its detail payload", async () => {
    const { h, fetch } = app();
    h.tickets.set('tk_1', ticket({ status: 'merging', mergeQueuedAt: '2026-09-01T11:00:00.000Z' }));

    const res = await fetch('/api/w/ws1/tickets/tk_1', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ mergeQueue: { position: 1, concurrency: 1 } });
  });

  it('reports no merge queue position for a ticket that is not waiting', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/tickets/tk_1', { headers: authed() });
    await expect(res.json()).resolves.toMatchObject({ mergeQueue: { position: null } });
  });

  it('serves the briefing snapshot', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/briefing', { headers: authed() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ warnings: [], needsYou: [] });
  });

  it('serves openapi.json and llms/api.txt without auth', async () => {
    const { fetch } = app();
    const doc = await (await fetch('/api/openapi.json')).json();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toContain('/api/w/{ws}/tickets');
    const txt = await (await fetch('/llms/api.txt')).text();
    expect(txt).toContain('ac_inbox');
    expect(txt).toContain('/api/w/{ws}/events');
  });

  it('falls back to the placeholder page when the UI is not built', async () => {
    const { fetch } = app();
    const res = await fetch('/some/spa/route');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('UI has not been built');
  });

  it('501s transcription when no provider is configured', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/transcribe', { method: 'POST', headers: authed(), body: 'audio' });
    expect(res.status).toBe(501);
  });

  // The chat finds the run to stream from this one request, so the envelope is part of the contract.
  it('serves the conductor as a detail envelope carrying its latest run', async () => {
    const { h, fetch } = app();
    const run = { id: 'run_live', agentId: 'ag_conductor', status: 'running' };
    h.impls['runs']!['list'] = () => ({ items: [run], total: 1 });

    const res = await fetch('/api/w/ws1/conductor', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worker).toMatchObject({ id: 'ag_conductor', kind: 'conductor' });
    expect(body.lastRun).toMatchObject({ id: 'run_live', status: 'running' });
    expect(h.calls.some((c) => c.service === 'runs' && c.method === 'list' && (c.args[0] as { agentId?: string })?.agentId === 'ag_conductor')).toBe(true);
  });

  it('serves a null lastRun when the conductor has never run', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/conductor', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worker).toMatchObject({ id: 'ag_conductor' });
    expect(body.lastRun).toBeNull();
  });

  // The project the human picked beside the chat input rides on the message; the route only has to
  // forward it, and to let the service's rejection surface as the error it is.
  it('forwards the project a chat message was sent with', async () => {
    const { h, fetch } = app();
    const seen: Array<Record<string, unknown> | undefined> = [];
    h.impls['threads']!['inbound'] = (_a: unknown, _t: unknown, body: string, opts?: Record<string, unknown>) => {
      seen.push(opts);
      return { id: 'tm_1', body, projectId: opts?.['projectId'] ?? null };
    };

    const withProject = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'ship it', projectId: 'p_api' }),
    });
    expect(withProject.status).toBe(201);
    expect((await withProject.json()).projectId).toBe('p_api');

    const without = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'no project' }),
    });
    expect(without.status).toBe(201);

    expect(seen.map((o) => o?.['projectId'])).toEqual(['p_api', undefined]);
  });

  it('surfaces an unknown project on a chat message as not_found', async () => {
    const { h, fetch } = app();
    h.impls['threads']!['inbound'] = () => { throw new OcError('not_found', 'project nope not found'); };

    const res = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'wrong project', projectId: 'nope' }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });

  // Same shape for the message a reply answers: forwarded verbatim, and the service's thread-scoped
  // rejection is what turns a reference to another thread's message into a 404.
  it('forwards the message a chat reply answers', async () => {
    const { h, fetch } = app();
    const seen: Array<Record<string, unknown> | undefined> = [];
    h.impls['threads']!['inbound'] = (_a: unknown, _t: unknown, body: string, opts?: Record<string, unknown>) => {
      seen.push(opts);
      return { id: 'tm_2', body, replyToMessageId: opts?.['replyToMessageId'] ?? null, replyToExcerpt: opts?.['replyToMessageId'] ? 'the question' : null };
    };

    const asReply = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'yes, do it', replyToMessageId: 'tm_asked' }),
    });
    expect(asReply.status).toBe(201);
    await expect(asReply.json()).resolves.toMatchObject({ replyToMessageId: 'tm_asked', replyToExcerpt: 'the question' });

    const plain = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'unprompted' }),
    });
    expect(plain.status).toBe(201);

    expect(seen.map((o) => o?.['replyToMessageId'])).toEqual(['tm_asked', undefined]);
  });

  it('surfaces a reply to a message outside the thread as not_found', async () => {
    const { h, fetch } = app();
    h.impls['threads']!['inbound'] = () => { throw new OcError('not_found', 'message tm_elsewhere not found in thread th_1'); };

    const res = await fetch('/api/w/ws1/threads/th_1/messages', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'crossing over', replyToMessageId: 'tm_elsewhere' }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });
});

describe('usage accounts', () => {
  const snapshot = {
    workspaceId: 'ws1', runtimeId: 'claude', billingType: 'subscription_included' as const, planLabel: 'max',
    limitsAvailable: true,
    limits: [{ kind: 'session' as const, label: 'Session', utilization: 42, resetsAt: '2026-09-05T18:09:59.000Z', scopeLabel: null }],
    note: null, capturedAt: '2026-09-05T17:00:00.000Z',
  };

  it('serves the snapshots with their windows and capture time', async () => {
    const { fetch } = app({ accounts: [snapshot] });
    const res = await fetch('/api/w/ws1/usage/accounts', { headers: authed() });
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ runtimeId: 'claude', billingType: 'subscription_included', planLabel: 'max', limitsAvailable: true, capturedAt: '2026-09-05T17:00:00.000Z' });
    expect(body[0]?.['limits']).toEqual(snapshot.limits);
  });

  it('falls back to the runtime id when no adapter is registered for a display name', async () => {
    const { fetch } = app({ accounts: [snapshot] });
    const body = await (await fetch('/api/w/ws1/usage/accounts', { headers: authed() })).json() as Array<Record<string, unknown>>;
    expect(body[0]?.['displayName']).toBe('claude');
  });

  it('returns an empty list when nothing has been probed yet', async () => {
    const { fetch } = app();
    expect(await (await fetch('/api/w/ws1/usage/accounts', { headers: authed() })).json()).toEqual([]);
  });

  it('is session-gated like the rest of the usage routes', async () => {
    const { fetch } = app({ accounts: [snapshot] });
    expect((await fetch('/api/w/ws1/usage/accounts')).status).toBe(401);
  });
});

describe('presentation', () => {
  it('returns the stored config, not a surface pick-list (VS-50)', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/presentation', { headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ default: 'headless' });
  });

  it('lists the surface kinds this daemon has adapters for, without a detection flag', async () => {
    const { h, fetch } = app();
    for (const kind of ['headless', 'tmux']) {
      h.deps.registries.surfaces.set(kind, { kind } as never);
    }
    const res = await fetch('/api/w/ws1/presentation/surfaces', { headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ surfaces: ['headless', 'tmux'] });
  });

  it('replaces the config on PUT and announces it', async () => {
    const { h, fetch } = app();
    const res = await fetch('/api/w/ws1/presentation', {
      method: 'PUT', headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ default: 'tmux', workers: { surface: 'tmux', session: 'ac' } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ default: 'tmux', workers: { surface: 'tmux', session: 'ac' } });
    expect(h.bus.since(0).filter((e) => e.type === 'presentation.updated')).toHaveLength(1);
  });

  it('is session-gated', async () => {
    const { fetch } = app();
    expect((await fetch('/api/w/ws1/presentation')).status).toBe(401);
    expect((await fetch('/api/w/ws1/presentation/surfaces')).status).toBe(401);
  });
});

describe('the workspace list', () => {
  /** The sidebar shows every workspace at once, so the count travels with the list. */
  const addDecision = (h: Harness, id: string, over: { owner?: string; status?: string } = {}): void => {
    h.db.run(
      "INSERT INTO decisions (id, workspace_id, ticket_id, kind, owner, title, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, 'ws1', null, 'question', over.owner ?? 'human', 'Needs a decision', over.status ?? 'open', '2026-09-01T00:00:00.000Z'],
    );
  };

  it('reports how many open decisions are waiting on the human', async () => {
    const { h, fetch } = app();
    addDecision(h, 'd_1');
    addDecision(h, 'd_2');
    addDecision(h, 'd_3', { status: 'answered' });
    addDecision(h, 'd_4', { owner: 'conductor' });

    const body = await (await fetch('/api/workspaces', { headers: authed() })).json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'ws1', name: 'Test workspace', ticketPrefix: 'ACME', needsYou: 2 });
  });

  it('reports zero rather than omitting the count', async () => {
    const { fetch } = app();
    const body = await (await fetch('/api/workspaces', { headers: authed() })).json() as Array<Record<string, unknown>>;
    expect(body[0]).toHaveProperty('needsYou', 0);
  });
});
