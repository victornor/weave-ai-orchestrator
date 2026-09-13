/**
 * `weave_schedule_wakeup` — the worker's own scheduled wakeup (VS-317). Exercised through `runTool`,
 * the same entry the MCP endpoint and the agent route use, against the real wake service over the
 * harness's real sqlite db.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createWakeService } from '@weave-ai/core';
import { nowIso } from '@weave-ai/db';
import type { ToolResult } from '@weave-ai/shared';
import { runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const WORKER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1' };
const CONDUCTOR: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_c', agentId: 'ag_conductor', agentKind: 'weaver', projectId: null, ticketId: null, roleId: null };
const OTHER = 'ag_other';

function seed(h: Harness): void {
  for (const id of ['ag_1', OTHER]) {
    h.db.insert('agents', {
      id, workspaceId: 'ws1', kind: 'worker', roleRevision: 1,
      name: id, runtimeId: 'claude', status: 'active', homePath: `/tmp/${id}`, worktreePath: `/tmp/${id}/work`, branch: 'ac/x',
      turnEpoch: 0, turnCount: 0, spawnedBy: 'system', briefRevision: 1, createdAt: nowIso(), updatedAt: nowIso(),
    });
  }
  h.runtime.services.wake = createWakeService(h.runtime.ctx, () => h.runtime.services);
}

const ctxFor = (h: Harness, claims: RunTokenClaims): ToolCtx =>
  ({ ws: h.runtime, claims, actor: { kind: 'agent', id: claims.agentId, runId: claims.runId } });
const call = (h: Harness, input: unknown, claims: RunTokenClaims = WORKER): Promise<ToolResult<never>> =>
  runTool('weave_schedule_wakeup', ctxFor(h, claims), input) as Promise<ToolResult<never>>;

const queuedSelfWakes = (h: Harness, agentId: string): Array<{ id: string; reason: string; notBefore: string | null; status: string }> =>
  h.db.all("SELECT id, reason, not_before AS notBefore, status FROM wakeups WHERE agent_id = ? AND source = 'self_scheduled' AND status = 'queued'", [agentId]);

describe('weave_schedule_wakeup (VS-317)', () => {
  it('queues a self-wake for the caller and reports its time and reason', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const res = await call(h, { reason: 'check the sweep', delayMinutes: 20 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const queued = queuedSelfWakes(h, 'ag_1');
    expect(queued).toHaveLength(1);
    expect(queued[0]!.reason).toBe('check the sweep');
    expect(Date.parse(queued[0]!.notBefore!)).toBeGreaterThan(Date.now() + 19 * 60_000);
  });

  it('accepts an absolute instant and rejects a past one', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    expect((await call(h, { reason: 'at the reset', at: future })).ok).toBe(true);
    expect(queuedSelfWakes(h, 'ag_1')).toHaveLength(1);
    const past = await call(h, { reason: 'too late', at: new Date(Date.now() - 60_000).toISOString() });
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.error.code).toBe('validation');
  });

  it('rejects neither and both of delayMinutes and at', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const neither = await call(h, { reason: 'x' });
    expect(neither.ok).toBe(false);
    const both = await call(h, { reason: 'x', delayMinutes: 5, at: new Date(Date.now() + 60 * 60_000).toISOString() });
    expect(both.ok).toBe(false);
    expect(queuedSelfWakes(h, 'ag_1')).toHaveLength(0);
  });

  it('rejects a delay outside the bounds', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const tooSoon = await call(h, { reason: 'now', delayMinutes: 0.1 });
    expect(tooSoon.ok).toBe(false);
    const tooFar = await call(h, { reason: 'next week', delayMinutes: 7 * 24 * 60 });
    expect(tooFar.ok).toBe(false);
    expect(queuedSelfWakes(h, 'ag_1')).toHaveLength(0);
  });

  it('replaces the previous self-wake rather than stacking a second', async () => {
    const h = makeHarness(); harness = h; seed(h);
    await call(h, { reason: 'first', delayMinutes: 20 });
    await call(h, { reason: 'second', delayMinutes: 30 });
    const queued = queuedSelfWakes(h, 'ag_1');
    expect(queued).toHaveLength(1);
    expect(queued[0]!.reason).toBe('second');
    const cancelled = h.db.all("SELECT id FROM wakeups WHERE agent_id = 'ag_1' AND source = 'self_scheduled' AND status = 'cancelled'");
    expect(cancelled).toHaveLength(1);
  });

  it('always schedules for the caller, whatever agent a caller names', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const res = await call(h, { reason: 'for someone else?', delayMinutes: 5, agentId: OTHER });
    expect(res.ok).toBe(true);
    expect(queuedSelfWakes(h, 'ag_1')).toHaveLength(1);
    expect(queuedSelfWakes(h, OTHER)).toHaveLength(0);
  });

  it('is forbidden to the weaver', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const res = await call(h, { reason: 'nudge', delayMinutes: 5 }, CONDUCTOR);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('forbidden');
    expect(queuedSelfWakes(h, 'ag_conductor')).toHaveLength(0);
  });
});

describe('the pending self-wake on the worker tools (VS-317)', () => {
  it('appears on weave_worker_list and weave_worker_get while queued', async () => {
    const h = makeHarness(); harness = h; seed(h);
    h.impls.workers!.list = () => [{ id: 'ag_1', name: 'Backend Engineer #1' }];
    h.impls.workers!.get = () => ({ id: 'ag_1', name: 'Backend Engineer #1' });
    h.impls.workers!.brief = () => 'brief';
    await call(h, { reason: 'check the sweep', delayMinutes: 20 });

    const list = await runTool('weave_worker_list', ctxFor(h, CONDUCTOR), {});
    expect((list.data as Array<Record<string, unknown>>)[0]!['scheduledWake']).toMatchObject({ reason: 'check the sweep' });

    const one = await runTool('weave_worker_get', ctxFor(h, CONDUCTOR), { id: 'ag_1' });
    expect((one.data as Record<string, unknown>)['scheduledWake']).toMatchObject({ reason: 'check the sweep' });
  });
});
