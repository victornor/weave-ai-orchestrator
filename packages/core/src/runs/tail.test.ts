import { afterEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createRunsService } from './index.js';

let h: TestHarness | null = null;
afterEach(() => { h?.cleanup(); h = null; });

/** A run with `count` events, seq 1..count. */
function seedRun(harness: TestHarness, count: number): string {
  const runId = newId();
  const agentId = harness.addWorker(null);
  harness.db.insert('runs', {
    id: runId, workspaceId: harness.workspaceId, agentId, wakeupIdsJson: [], runtimeId: 'claude',
    status: 'running', turnEpoch: 1, cwd: harness.root, createdAt: nowIso(),
  });
  for (let seq = 1; seq <= count; seq += 1) {
    harness.db.run('INSERT INTO run_events (run_id, seq, ts, type, stream, level, payload_json) VALUES (?,?,?,?,?,?,?)',
      [runId, seq, nowIso(), 'assistant.text', 'stdout', 'info', JSON.stringify({ text: `event ${seq}` })]);
  }
  return runId;
}

describe('RunsService.tail', () => {
  it('returns the newest events in ascending sequence order', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const runId = seedRun(h, 100);

    const tail = runs.tail(runId, 5);

    expect(tail.map((e) => e.seq)).toEqual([96, 97, 98, 99, 100]);
    expect(tail[0]!.payload).toEqual({ text: 'event 96' });
  });

  it('returns the whole run when it is shorter than the limit', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const runId = seedRun(h, 3);

    expect(runs.tail(runId, 50).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('returns nothing for a run with no events', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());

    expect(runs.tail(seedRun(h, 0), 10)).toEqual([]);
    expect(runs.tail('no_such_run', 10)).toEqual([]);
  });

  it('reads the tail that events() cannot page to', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const runId = seedRun(h, 100);

    // events() pages forward from a sequence, so a small limit gives the head, not the tail.
    expect(runs.events(runId, 0, 5).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(runs.tail(runId, 5).map((e) => e.seq)).toEqual([96, 97, 98, 99, 100]);
  });
});
