/**
 * VS-386: `GET /api/runs/{id}` resolves a run by id alone across the loaded workspaces for the
 * global V2 run detail. It must find a run in a workspace other than the first loaded, and a run
 * token must not reach it (like every other daemon read).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { OcError, type Run } from '@weave-ai/shared';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import type { WorkspaceRuntime } from '../src/types.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const RUN: Run = {
  id: 'run_beta', workspaceId: 'ws2', agentId: 'ag_2', ticketId: null, sessionId: null,
  wakeupIds: ['wk_1'], runtimeId: 'claude-code', model: 'sonnet-4.6', status: 'succeeded',
  turnEpoch: 1, cwd: '/w', startedAt: '2026-09-01T09:00:00.000Z', finishedAt: '2026-09-01T09:00:51.000Z',
  exitCode: 0, signal: null, pid: null, pgid: null, errorCode: null, errorFamily: null,
  retryOfRunId: null, usage: null, costCents: null, result: null, liveness: null, logPath: null,
  summary: null, createdAt: '2026-09-01T09:00:00.000Z',
};

/** A second runtime whose `runs.get` answers only for its own run. */
function secondWorkspace(alpha: WorkspaceRuntime, id: string, run: Run): WorkspaceRuntime {
  return {
    ...alpha,
    id,
    services: {
      ...alpha.services,
      runs: { get: (rid: string) => { if (rid === run.id) return run; throw new OcError('not_found', `run ${rid} not found`); } } as unknown as WorkspaceRuntime['services']['runs'],
    },
  };
}

describe('GET /api/runs/{id} (VS-386)', () => {
  it('finds a run in a workspace other than the first loaded, and 404s an unknown id', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const impls = harness.impls.runs as Record<string, unknown>;
    // The first workspace does not have the run; the second does.
    impls.get = () => { throw new OcError('not_found', 'run not here'); };
    harness.deps.workspaces.set('ws2', secondWorkspace(harness.runtime, 'ws2', RUN));

    const app = createApp(harness.deps);
    const found = await app.fetch(new Request('http://127.0.0.1/api/runs/run_beta', { headers: authed() }));
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ id: 'run_beta', workspaceId: 'ws2' });

    const missing = await app.fetch(new Request('http://127.0.0.1/api/runs/nope', { headers: authed() }));
    expect(missing.status).toBe(404);
  });

  it('rejects a run token', async () => {
    harness = makeHarness({ listener: 'loopback' });
    const app = createApp(harness.deps);
    const token = await signRunToken(runTokenSecret(harness.runtime.ctx.db), {
      workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1',
    });
    const res = await app.fetch(new Request('http://127.0.0.1/api/runs/run_1', { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(403);
  });
});
