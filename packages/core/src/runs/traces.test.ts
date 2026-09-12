/**
 * VS-74: `RunsService.traces` — what a run did, counted off its stored events, for the chat's
 * collapsed "what it did" line.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@weave-ai/db';
import type { RunEventType } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createRunsService } from './index.js';

let h: TestHarness | null = null;
afterEach(() => { h?.cleanup(); h = null; });

type Seed = { type: RunEventType; payload?: Record<string, unknown> };

function seedRun(harness: TestHarness, events: Seed[], run: Record<string, unknown> = {}): string {
  const runId = newId();
  const agentId = harness.addWorker(null);
  harness.db.insert('runs', {
    id: runId, workspaceId: harness.workspaceId, agentId, wakeupIdsJson: [], runtimeId: 'claude',
    status: 'succeeded', turnEpoch: 1, cwd: harness.root, createdAt: nowIso(), ...run,
  });
  events.forEach((e, i) => {
    harness.db.run('INSERT INTO run_events (run_id, seq, ts, type, stream, level, payload_json) VALUES (?,?,?,?,?,?,?)',
      [runId, i + 1, nowIso(), e.type, 'stdout', 'info', JSON.stringify(e.payload ?? {})]);
  });
  return runId;
}

describe('RunsService.traces', () => {
  it('counts tool calls, distinct files, errors and assistant text off the run events', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const runId = seedRun(h, [
      { type: 'assistant.text', payload: { text: 'looking' } },
      { type: 'assistant.thinking', payload: { text: 'hmm' } },
      { type: 'tool.call', payload: { name: 'Read' } },
      { type: 'tool.result', payload: { name: 'Read' } },
      { type: 'tool.call', payload: { name: 'Edit' } },
      { type: 'file.changed', payload: { path: 'a.ts' } },
      { type: 'file.changed', payload: { path: 'a.ts' } },
      { type: 'file.changed', payload: { path: 'b.ts' } },
      { type: 'error', payload: { message: 'nope' } },
    ]);

    const [trace] = runs.traces({ ids: [runId] });

    expect(trace).toMatchObject({ runId, toolCalls: 2, files: 2, errors: 1, texts: 2, events: 9 });
  });

  it('reports the run status, its own duration and its summary', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const runId = seedRun(h, [{ type: 'tool.call' }], {
      status: 'failed',
      startedAt: '2026-09-07T09:00:00.000Z',
      finishedAt: '2026-09-07T09:00:12.500Z',
      summary: 'filed VS-9',
    });

    const [trace] = runs.traces({ ids: [runId] });

    expect(trace).toMatchObject({ status: 'failed', durationMs: 12500, summary: 'filed VS-9' });
  });

  it('leaves the duration unknown while the run is still going', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const runId = seedRun(h, [], { status: 'running', startedAt: '2026-09-07T09:00:00.000Z' });

    expect(runs.traces({ ids: [runId] })[0]).toMatchObject({ durationMs: null, toolCalls: 0, files: 0, errors: 0, texts: 0, events: 0 });
  });

  it('omits an id that names no run in this workspace and still answers for the rest', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const runId = seedRun(h, [{ type: 'tool.call' }]);

    const traces = runs.traces({ ids: ['run_nope', runId] });

    expect(traces.map((t) => t.runId)).toEqual([runId]);
  });

  it('answers oldest first, once per run, and asks nothing when nothing is selected', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const older = seedRun(h, [], { createdAt: '2026-09-07T09:00:00.000Z' });
    const newer = seedRun(h, [], { createdAt: '2026-09-07T09:05:00.000Z' });

    expect(runs.traces({ ids: [newer, older, newer] }).map((t) => t.runId)).toEqual([older, newer]);
    expect(runs.traces({})).toEqual([]);
  });

  it('carries the run’s model and token usage (VS-204)', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const usage = { inputTokens: 12_000, outputTokens: 400, cachedInputTokens: 0, contextTokens: 8_200, basis: 'per_turn' };
    const runId = seedRun(h, [{ type: 'tool.call' }], { model: 'claude-opus-5', usageJson: usage });

    const [trace] = runs.traces({ ids: [runId] });

    expect(trace).toMatchObject({ model: 'claude-opus-5', usage });
  });

  it('carries no usage for a run whose runtime reported none (VS-204)', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const runId = seedRun(h, [{ type: 'tool.call' }]);

    const [trace] = runs.traces({ ids: [runId] });

    expect(trace).toMatchObject({ model: null, usage: null });
  });

  it('adds every run an agent took since a time, so a turn nothing else names is still described', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const agentId = h.addWorker(null);
    const before = seedRun(h, [], { agentId, createdAt: '2026-09-07T08:00:00.000Z' });
    const during = seedRun(h, [{ type: 'tool.call' }], { agentId, createdAt: '2026-09-07T09:30:00.000Z' });
    seedRun(h, [], { createdAt: '2026-09-07T09:40:00.000Z' });

    const window = runs.traces({ agentId, since: '2026-09-07T09:00:00.000Z' });

    expect(window.map((t) => t.runId)).toEqual([during]);
    // The ids are a union with the window, not a filter on it.
    expect(runs.traces({ ids: [before], agentId, since: '2026-09-07T09:00:00.000Z' }).map((t) => t.runId)).toEqual([before, during]);
  });

  it('keeps the newest runs when the window is larger than the limit', () => {
    h = makeHarness();
    const runs = createRunsService(h.ctx, () => h!.deps());
    const agentId = h.addWorker(null);
    seedRun(h, [], { agentId, createdAt: '2026-09-07T09:00:00.000Z' });
    const second = seedRun(h, [], { agentId, createdAt: '2026-09-07T09:01:00.000Z' });
    const third = seedRun(h, [], { agentId, createdAt: '2026-09-07T09:02:00.000Z' });

    expect(runs.traces({ agentId, since: '2026-09-07T08:00:00.000Z', limit: 2 }).map((t) => t.runId)).toEqual([second, third]);
  });

});
