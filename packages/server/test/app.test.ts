import { describe, expect, it, afterEach } from 'vitest';
import { OcError } from '@agent-conductor/shared';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import { authed, makeHarness, type Harness } from './fakes.js';

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
});
