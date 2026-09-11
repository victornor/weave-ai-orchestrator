import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeRuntime } from '@agent-conductor/runtime-sdk';
import { OcError, type Agent } from '@agent-conductor/shared';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const app = (opts?: Parameters<typeof makeHarness>[0]) => {
  harness = makeHarness(opts);
  return { h: harness, fetch: (path: string, init?: RequestInit) => createApp(harness!.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
};

function worker(over: Partial<Agent> = {}): Agent {
  return {
    id: 'ag_1', workspaceId: 'ws1', kind: 'worker', projectId: 'proj1', roleId: 'role1', roleRevision: 1,
    ticketId: 'tk_1', name: 'Backend Engineer #1', runtimeId: 'fake', status: 'active', pauseReason: null,
    pauseDetail: null, errorText: null, homePath: '/tmp/home', worktreePath: null, branch: null, turnEpoch: 1,
    turnCount: 1, spawnedBy: 'system', spawnReason: null, briefRevision: 1, lastRunAt: null, retiredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('GET /workers — interactiveSession (VS-101)', () => {
  it('marks a worker whose ticket is an interactive session, and no others', async () => {
    const { h, fetch } = app();
    h.db.run(
      "INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, status, interactive_session, created_by_kind, created_at, updated_at) VALUES ('tk_session','ws1',1,'ACME-1','task','Debug it','in_progress',1,'human','t0','t0')",
    );
    h.db.run(
      "INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, status, interactive_session, created_by_kind, created_at, updated_at) VALUES ('tk_normal','ws1',2,'ACME-2','task','Fix the bug','in_progress',0,'human','t0','t0')",
    );
    h.impls.workers!['list'] = () => [
      worker({ id: 'ag_session', ticketId: 'tk_session' }),
      worker({ id: 'ag_normal', ticketId: 'tk_normal' }),
      worker({ id: 'ag_bare', ticketId: null }),
    ];

    const res = await fetch('/api/w/ws1/workers', { headers: authed() });
    expect(res.status).toBe(200);
    const list: Array<{ id: string; interactiveSession: boolean }> = await res.json();
    expect(list.find((w) => w.id === 'ag_session')?.interactiveSession).toBe(true);
    expect(list.find((w) => w.id === 'ag_normal')?.interactiveSession).toBe(false);
    expect(list.find((w) => w.id === 'ag_bare')?.interactiveSession).toBe(false);
  });
});

describe('POST /workers/start-session (VS-101)', () => {
  it('starts a session against an existing ticket', async () => {
    const { h, fetch } = app();
    const startInteractiveSession = vi.fn(async () => worker({ id: 'ag_session', ticketId: 'tk_1' }));
    h.impls.workers!['startInteractiveSession'] = startInteractiveSession;

    const res = await fetch('/api/w/ws1/workers/start-session', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ ticketId: 'tk_1' }),
    });
    expect(res.status).toBe(201);
    const agent = await res.json();
    expect(agent.id).toBe('ag_session');
    expect(startInteractiveSession).toHaveBeenCalledWith(expect.anything(), { ticketId: 'tk_1' });
  });

  it('starts a session by creating a ticket in the same action', async () => {
    const { h, fetch } = app();
    const startInteractiveSession = vi.fn(async () => worker({ id: 'ag_session', ticketId: 'tk_new' }));
    h.impls.workers!['startInteractiveSession'] = startInteractiveSession;

    const res = await fetch('/api/w/ws1/workers/start-session', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ projectId: 'proj1', roleId: 'role1', kind: 'task', title: 'Debug the flaky test' }),
    });
    expect(res.status).toBe(201);
    expect(startInteractiveSession).toHaveBeenCalledWith(
      expect.anything(), { projectId: 'proj1', roleId: 'role1', kind: 'task', title: 'Debug the flaky test' },
    );
  });

  it('refuses a body matching neither shape', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/workers/start-session', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'no project or ticket' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /workers/:id — input.midTurn (VS-99)', () => {
  it('names the reason for a runtime that cannot take mid-turn input at all', async () => {
    const { h, fetch } = app();
    const runtime = new FakeRuntime();
    runtime.streamingInput = false;
    h.runtime.ctx.registries.runtimes.set('fake', runtime);
    h.impls.workers!['get'] = () => worker();

    const res = await fetch('/api/w/ws1/workers/ag_1', { headers: authed() });
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.input.midTurn).toBe(false);
    expect(detail.input.reason).toMatch(/does not support/);
  });

  it('says no turn is running for a capable runtime between turns', async () => {
    const { h, fetch } = app();
    const runtime = new FakeRuntime();
    runtime.streamingInput = true;
    h.runtime.ctx.registries.runtimes.set('fake', runtime);
    h.impls.workers!['get'] = () => worker();

    const res = await fetch('/api/w/ws1/workers/ag_1', { headers: authed() });
    const detail = await res.json();
    expect(detail.input).toEqual({ midTurn: false, reason: expect.stringMatching(/no turn is currently running/) });
  });
});

describe('GET /workers/:id — sessionResumable (VS-106)', () => {
  it('reports whether the worker has a resumable session', async () => {
    const { h, fetch } = app();
    h.impls.workers!['get'] = () => worker();
    h.impls.workers!['sessionResumable'] = () => true;

    const res = await fetch('/api/w/ws1/workers/ag_1', { headers: authed() });
    expect((await res.json()).sessionResumable).toBe(true);
  });

  it('reports false once the session has closed', async () => {
    const { h, fetch } = app();
    h.impls.workers!['get'] = () => worker({ status: 'retired', retiredAt: '2026-09-07T00:00:00.000Z' });
    h.impls.workers!['sessionResumable'] = () => false;

    const res = await fetch('/api/w/ws1/workers/ag_1', { headers: authed() });
    expect((await res.json()).sessionResumable).toBe(false);
  });
});

describe('POST /workers/:id/message — refuses a retired worker (VS-106)', () => {
  it('surfaces wrong_status rather than a 202', async () => {
    const { h, fetch } = app();
    h.impls.workers!['message'] = async () => {
      throw new OcError('wrong_status', 'Backend Engineer #1 has retired; reply on the ticket to reopen it instead');
    };

    const res = await fetch('/api/w/ws1/workers/ag_1/message', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'still there?', live: true }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('wrong_status');
  });
});

describe('POST /workers/:id/message — delivery outcome (VS-99)', () => {
  it('reports mid_turn when the service delivers to the running turn', async () => {
    const { h, fetch } = app();
    h.impls.workers!['message'] = async () => ({ delivery: 'mid_turn' as const, runId: 'run_1', wake: null });

    const res = await fetch('/api/w/ws1/workers/ag_1/message', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'check the logs', live: true }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ delivery: 'mid_turn', runId: 'run_1', wakeId: null });
  });

  it('reports queued with the wake id when it could not be delivered mid-turn', async () => {
    const { h, fetch } = app();
    h.impls.workers!['message'] = async () => ({ delivery: 'queued' as const, runId: 'run_1', wake: { id: 'wk_9' } });

    const res = await fetch('/api/w/ws1/workers/ag_1/message', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body: 'do this next' }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ delivery: 'queued', runId: 'run_1', wakeId: 'wk_9' });
  });
});

describe('session handover (VS-249)', () => {
  it('GET handover-command is read-only and reports the offered command', async () => {
    const { h, fetch } = app();
    const handoverCommand = vi.fn(() => ({ resumable: true, command: "cd '/home/a1' && claude --resume sess-1", runtime: 'claude', landingLine: 'lands in home', reason: null }));
    h.impls.workers!['handoverCommand'] = handoverCommand;

    const res = await fetch('/api/w/ws1/workers/ag_1/handover-command', { headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resumable: true, runtime: 'claude' });
    expect(handoverCommand).toHaveBeenCalledWith('ag_1');
  });

  it('POST handover takes the session and returns the command', async () => {
    const { h, fetch } = app();
    const startHandover = vi.fn(async () => ({ resumable: true, command: "cd '/home/a1' && claude --resume sess-1", runtime: 'claude', landingLine: 'lands in home', reason: null }));
    h.impls.workers!['startHandover'] = startHandover;

    const res = await fetch('/api/w/ws1/workers/ag_1/handover', { method: 'POST', headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resumable: true });
    expect(startHandover).toHaveBeenCalledWith(expect.anything(), 'ag_1');
  });

  it('POST handover refuses a worker with a turn running', async () => {
    const { h, fetch } = app();
    h.impls.workers!['startHandover'] = async () => { throw new OcError('wrong_status', 'Backend Engineer #1 has a turn running; wait for it or cancel first'); };

    const res = await fetch('/api/w/ws1/workers/ag_1/handover', { method: 'POST', headers: authed() });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('wrong_status');
  });

  it('POST handover refuses a worker whose session is already held', async () => {
    const { h, fetch } = app();
    h.impls.workers!['startHandover'] = async () => { throw new OcError('wrong_status', "Backend Engineer #1's session is already held"); };

    const res = await fetch('/api/w/ws1/workers/ag_1/handover', { method: 'POST', headers: authed() });
    expect(res.status).toBe(409);
  });

  it('POST handback requires a note', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/workers/ag_1/handback', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST handback gives the session back with the note', async () => {
    const { h, fetch } = app();
    const endHandover = vi.fn(async () => ({
      note: 'debugged over USB',
      reconciliation: { worktree: { headBefore: 'a', headAfter: 'b', newCommits: 1, dirty: false, changedFiles: 0 }, sessionActivityDetected: true, durationMs: 60_000 },
    }));
    h.impls.workers!['endHandover'] = endHandover;

    const res = await fetch('/api/w/ws1/workers/ag_1/handback', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ note: 'debugged over USB' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ note: 'debugged over USB' });
    expect(endHandover).toHaveBeenCalledWith(expect.anything(), 'ag_1', 'debugged over USB');
  });
});
