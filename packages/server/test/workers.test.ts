import { afterEach, describe, expect, it } from 'vitest';
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
