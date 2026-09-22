/**
 * VS-410: `RunsService.list` orders the whole history by cost, tokens or duration, not just by
 * recency — the V2 Runs screen's sort. Duration for a run still going is its elapsed time so far.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createRunsService } from './index.js';

let h: TestHarness | null = null;
afterEach(() => { h?.cleanup(); h = null; });

function seed(harness: TestHarness, run: Record<string, unknown> = {}): string {
  const id = newId();
  harness.db.insert('runs', {
    id,
    workspaceId: harness.workspaceId,
    agentId: harness.addWorker(null),
    wakeupIdsJson: [],
    runtimeId: 'claude',
    status: 'succeeded',
    turnEpoch: 1,
    cwd: harness.root,
    createdAt: '2026-09-07T09:00:00.000Z',
    ...run,
  });
  return id;
}

function usage(inputTokens: number, outputTokens: number): Record<string, unknown> {
  return { inputTokens, outputTokens, cachedInputTokens: 0, basis: 'per_turn' };
}

describe('RunsService.list ordering (VS-410)', () => {
  it('keeps the default order most recent first', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const older = seed(h, { createdAt: '2026-09-07T09:00:00.000Z' });
    const newer = seed(h, { createdAt: '2026-09-07T10:00:00.000Z' });

    expect(runs.list().items.map((r) => r.id)).toEqual([newer, older]);
  });

  it('orders by cost, highest first, and puts a run with no cost last either way', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const cheap = seed(h, { costCents: 5 });
    const dear = seed(h, { costCents: 500 });
    const free = seed(h, { costCents: 0 });
    const unknown = seed(h, { costCents: null });

    expect(runs.list({ sort: 'cost', dir: 'desc' }).items.map((r) => r.id)).toEqual([dear, cheap, free, unknown]);
    expect(runs.list({ sort: 'cost', dir: 'asc' }).items.map((r) => r.id)).toEqual([free, cheap, dear, unknown]);
  });

  it('orders by the run’s own input plus output tokens', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const small = seed(h, { usageJson: usage(1_000, 200) });
    const large = seed(h, { usageJson: usage(80_000, 4_000) });
    const none = seed(h, { usageJson: null });

    expect(runs.list({ sort: 'tokens', dir: 'desc' }).items.map((r) => r.id)).toEqual([large, small, none]);
    expect(runs.list({ sort: 'tokens', dir: 'asc' }).items.map((r) => r.id)).toEqual([small, large, none]);
  });

  it('orders by duration, longest first, counting a running run’s elapsed time', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const quick = seed(h, { startedAt: '2026-09-07T09:00:00.000Z', finishedAt: '2026-09-07T09:00:05.000Z' });
    const slow = seed(h, { startedAt: '2026-09-07T09:00:00.000Z', finishedAt: '2026-09-07T09:10:00.000Z' });
    // Still running, started an hour ago: its elapsed time beats every finished run here.
    const running = seed(h, { status: 'running', startedAt: new Date(Date.now() - 3_600_000).toISOString(), finishedAt: null });
    const neverStarted = seed(h, { startedAt: null, finishedAt: null });

    expect(runs.list({ sort: 'duration', dir: 'desc' }).items.map((r) => r.id)).toEqual([running, slow, quick, neverStarted]);
    expect(runs.list({ sort: 'duration', dir: 'asc' }).items.map((r) => r.id)).toEqual([quick, slow, running, neverStarted]);
  });

  it('exposes a scheduled retry instant on the run, and null when it is not retried (VS-663)', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const due = '2026-09-22T02:00:30.000Z';
    const retrying = seed(h, { status: 'failed', scheduledRetryAt: due });
    const terminal = seed(h, { status: 'failed' });
    const byId = new Map(runs.list().items.map((r) => [r.id, r]));

    expect(byId.get(retrying)!.scheduledRetryAt).toBe(due);
    expect(byId.get(terminal)!.scheduledRetryAt).toBeNull();
  });

  it('pages a sorted list with limit and offset', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const a = seed(h, { costCents: 10 });
    const b = seed(h, { costCents: 30 });
    const c = seed(h, { costCents: 20 });

    const page = runs.list({ sort: 'cost', dir: 'desc', limit: 2, offset: 0 });
    expect(page.items.map((r) => r.id)).toEqual([b, c]);
    expect(page.total).toBe(3);
    expect(runs.list({ sort: 'cost', dir: 'desc', limit: 2, offset: 2 }).items.map((r) => r.id)).toEqual([a]);
  });
});
