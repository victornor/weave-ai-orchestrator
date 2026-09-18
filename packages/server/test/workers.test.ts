import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeRuntime } from '@weave-ai/runtime-sdk';
import { OcError, type Agent } from '@weave-ai/shared';
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

describe('GET /workers — activity summary (VS-328)', () => {
  it('carries the live activity line and last test tally', async () => {
    const { h, fetch } = app();
    h.impls.workers!['list'] = () => [worker({ id: 'ag_1' })];
    h.impls.activity!['summaryFor'] = (id: string) => id === 'ag_1'
      ? { agentId: 'ag_1', ticketId: 'tk_1', activity: { verb: 'editing', label: 'Editing src/a.ts', target: 'src/a.ts', since: '2026-09-13T10:00:00.000Z' }, tests: { passed: 28, total: 28 } }
      : null;

    const res = await fetch('/api/w/ws1/workers', { headers: authed() });
    const list: Array<Record<string, unknown>> = await res.json();
    expect(list[0]).toMatchObject({ activity: { verb: 'editing', label: 'Editing src/a.ts' }, tests: { passed: 28, total: 28 } });
  });

  it('reports nulls when the worker has no summary', async () => {
    const { h, fetch } = app();
    h.impls.workers!['list'] = () => [worker({ id: 'ag_1' })];

    const res = await fetch('/api/w/ws1/workers', { headers: authed() });
    const list: Array<Record<string, unknown>> = await res.json();
    expect(list[0]).toMatchObject({ activity: null, tests: null });
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

describe('POST /workers/persistent-session (VS-495)', () => {
  it('opens a role\'s persistent session and returns it with its thread', async () => {
    const { h, fetch } = app();
    const ensureSession = vi.fn(async () => ({ agent: worker({ id: 'ag_session', kind: 'session', ticketId: null }), thread: { id: 'th_1', channelKind: 'web', agentId: 'ag_session' } }));
    h.impls.workers!['ensureSession'] = ensureSession;

    const res = await fetch('/api/w/ws1/workers/persistent-session', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ projectId: 'proj1', roleId: 'role1' }),
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.agent.id).toBe('ag_session');
    expect(out.thread.id).toBe('th_1');
    expect(ensureSession).toHaveBeenCalledWith(expect.anything(), 'proj1', 'role1', null);
  });

  it('passes a chosen worker option through to the session open (VS-526)', async () => {
    const { h, fetch } = app();
    const ensureSession = vi.fn(async () => ({ agent: worker({ id: 'ag_session', kind: 'session', ticketId: null }), thread: { id: 'th_1', channelKind: 'web', agentId: 'ag_session' } }));
    h.impls.workers!['ensureSession'] = ensureSession;

    const res = await fetch('/api/w/ws1/workers/persistent-session', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ projectId: 'proj1', roleId: 'role1', workerModelId: 'deep' }),
    });
    expect(res.status).toBe(200);
    expect(ensureSession).toHaveBeenCalledWith(expect.anything(), 'proj1', 'role1', 'deep');
  });

  it('changes a session\'s worker option through its own route (VS-526)', async () => {
    const { h, fetch } = app();
    const setSessionOption = vi.fn(async () => ({ id: 'ag_session', kind: 'session' }));
    h.impls.workers!['setSessionOption'] = setSessionOption;

    const res = await fetch('/api/w/ws1/workers/ag_session/session-option', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ workerModelId: 'quick' }),
    });
    expect(res.status).toBe(200);
    expect(setSessionOption).toHaveBeenCalledWith(expect.anything(), 'ag_session', 'quick');
  });

  it('refuses a body missing projectId or roleId', async () => {
    const { fetch } = app();
    const res = await fetch('/api/w/ws1/workers/persistent-session', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ projectId: 'proj1' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /workers — kind filter (VS-525)', () => {
  it('passes a kind list through so a role session can be read', async () => {
    const { h, fetch } = app();
    const list = vi.fn(() => [worker({ id: 'ag_session', kind: 'session', ticketId: null })]);
    h.impls.workers!['list'] = list;

    const res = await fetch('/api/w/ws1/workers?kind=session&project=proj1', { headers: authed() });
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['session'], projectId: 'proj1' }));
  });

  it('omits the filter when no kind is asked for, keeping the worker default', async () => {
    const { h, fetch } = app();
    const list = vi.fn(() => [worker({ id: 'ag_1' })]);
    h.impls.workers!['list'] = list;

    await fetch('/api/w/ws1/workers', { headers: authed() });
    expect((list.mock.calls[0]![0] as { kinds?: string[] }).kinds).toBeUndefined();
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

describe('GET /workers — stalled (VS-498)', () => {
  function seedStallRow(h: Harness, agentId: string, ticketId: string): void {
    h.db.run(
      "INSERT INTO tickets (id, workspace_id, number, identifier, kind, title, status, created_by_kind, created_at, updated_at) VALUES (?, 'ws1', 3, 'ACME-3', 'task', 'Do the thing', 'in_progress', 'human', 't0', 't0')",
      [ticketId],
    );
    h.db.run(
      "INSERT INTO agents (id, workspace_id, kind, ticket_id, name, runtime_id, status, home_path, created_at, updated_at) VALUES (?, 'ws1', 'worker', ?, 'Backend Engineer #1', 'fake', 'active', '/tmp/home', 't0', 't0')",
      [agentId, ticketId],
    );
    h.db.insert('worker_stall_state', { agentId, workspaceId: 'ws1', ticketId, attempts: 1, firstDetectedAt: 't0', createdAt: 't0', updatedAt: 't0' });
  }

  it('marks a worker in an active stall/recovery cycle, and no others, on the workers list', async () => {
    const { h, fetch } = app();
    seedStallRow(h, 'ag_stalled', 'tk_stalled');
    h.impls.workers!['list'] = () => [worker({ id: 'ag_stalled', ticketId: 'tk_stalled' }), worker({ id: 'ag_ok', ticketId: 'tk_1' })];

    const res = await fetch('/api/w/ws1/workers', { headers: authed() });
    const list: Array<{ id: string; stalled: boolean }> = await res.json();
    expect(list.find((w) => w.id === 'ag_stalled')?.stalled).toBe(true);
    expect(list.find((w) => w.id === 'ag_ok')?.stalled).toBe(false);
  });

  it('marks a stalled worker on its own detail read', async () => {
    const { h, fetch } = app();
    seedStallRow(h, 'ag_stalled', 'tk_stalled');
    h.impls.workers!['get'] = () => worker({ id: 'ag_stalled', ticketId: 'tk_stalled' });

    const res = await fetch('/api/w/ws1/workers/ag_stalled', { headers: authed() });
    expect((await res.json()).stalled).toBe(true);
  });

  it('does not mark a worker with no active stall/recovery cycle', async () => {
    const { h, fetch } = app();
    h.impls.workers!['get'] = () => worker();

    const res = await fetch('/api/w/ws1/workers/ag_1', { headers: authed() });
    expect((await res.json()).stalled).toBe(false);
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

describe('GET /workers — session context size (VS-554)', () => {
  function seedAgent(h: Harness, id: string): void {
    h.db.run(
      "INSERT INTO agents (id, workspace_id, kind, name, runtime_id, status, home_path, created_at, updated_at) VALUES (?, 'ws1', 'worker', ?, 'fake', 'active', '/tmp/home', 't0', 't0')",
      [id, id],
    );
  }

  it('carries the active session last context size, and null without one', async () => {
    const { h, fetch } = app();
    seedAgent(h, 'ag_ctx');
    seedAgent(h, 'ag_no_ctx');
    h.db.insert('agent_sessions', {
      id: 'sess_ctx', agentId: 'ag_ctx', runtimeId: 'fake', status: 'active', turnCount: 1,
      cumulativeUsageJson: {}, lastContextTokens: 123_456, createdAt: 't0', updatedAt: 't0',
    });
    h.impls.workers!['list'] = () => [worker({ id: 'ag_ctx' }), worker({ id: 'ag_no_ctx' })];

    const res = await fetch('/api/w/ws1/workers', { headers: authed() });
    const list: Array<{ id: string; lastContextTokens: number | null }> = await res.json();
    expect(list.find((w) => w.id === 'ag_ctx')?.lastContextTokens).toBe(123_456);
    expect(list.find((w) => w.id === 'ag_no_ctx')?.lastContextTokens).toBeNull();
  });
});
