/** V2's live worker line (VS-368): the pushed frame's precedence over the workers-read row, and the run-summary fallback. */
import { describe, expect, it } from 'vitest';
import type { WorkerActivitySummary } from '@weave-ai/shared';
import { activityLine, mergeWorkerActivity } from '../lib/workerActivity';

const frame = (over: Partial<WorkerActivitySummary> = {}): WorkerActivitySummary => ({
  agentId: 'a1',
  ticketId: 'tk_1',
  activity: { verb: 'testing', label: 'Running tests', target: null, since: '2026-09-13T12:00:00.000Z' },
  tests: { passed: 30, total: 30 },
  ...over,
});

const noPushed = new Map<string, WorkerActivitySummary>();

describe('merging a pushed activity frame over the workers read', () => {
  it('prefers the pushed frame once one has arrived', () => {
    const pushed = new Map([['a1', frame()]]);
    expect(mergeWorkerActivity({ id: 'a1', activity: { verb: 'editing', label: 'Editing a.ts', target: 'a.ts', since: 'x' }, tests: { passed: 1, total: 1 } }, pushed)).toEqual({
      activity: { verb: 'testing', label: 'Running tests', target: null, since: '2026-09-13T12:00:00.000Z' },
      live: null,
      tests: { passed: 30, total: 30 },
    });
  });

  it('lets a pushed frame with a null activity clear the query line', () => {
    const pushed = new Map([['a1', frame({ activity: null, tests: null })]]);
    expect(mergeWorkerActivity({ id: 'a1', activity: { verb: 'editing', label: 'Editing stale.ts', target: 'stale.ts', since: 'x' }, tests: { passed: 1, total: 1 } }, pushed)).toEqual({ activity: null, live: null, tests: null });
  });

  it('carries the live-turn state the daemon computed (VS-602)', () => {
    const live = { state: 'waiting', label: 'Working', since: '2026-09-13T12:00:04.000Z', toolCount: 3, turnMs: 9000, sinceLastMs: 4000, wholeStepsOnly: false };
    const pushed = new Map([['a1', frame({ live })]]);
    expect(mergeWorkerActivity({ id: 'a1' }, pushed)?.live).toEqual(live);
  });

  it('falls back to the workers-read row when no frame has arrived', () => {
    const row = { id: 'a1', activity: { verb: 'reading' as const, label: 'Reading code', target: null, since: 'y' }, tests: { passed: 2, total: 3 } };
    expect(mergeWorkerActivity(row, noPushed)).toEqual({ activity: row.activity, live: null, tests: row.tests });
  });

  it('is null without a worker, and normalises missing fields', () => {
    expect(mergeWorkerActivity(null, noPushed)).toBeNull();
    expect(mergeWorkerActivity(undefined, noPushed)).toBeNull();
    expect(mergeWorkerActivity({ id: 'a1' }, noPushed)).toEqual({ activity: null, live: null, tests: null });
  });
});

describe('choosing the line to render', () => {
  const summary = { activity: { verb: 'testing' as const, label: 'Running tests', target: null, since: '2026-09-13T12:00:00.000Z' }, live: null, tests: { passed: 30, total: 30 } };

  it('shows the current activity with its start time', () => {
    expect(activityLine(summary, 'last turn summary')).toEqual({ label: 'Running tests', since: '2026-09-13T12:00:00.000Z' });
  });

  it('prefers the live-turn state over the per-event line, so a card is never a bare word (VS-602)', () => {
    const live = { state: 'waiting', label: 'Working', since: '2026-09-13T12:00:09.000Z', toolCount: 3, turnMs: 9000, sinceLastMs: 4000, wholeStepsOnly: false };
    expect(activityLine({ ...summary, live }, null)).toEqual({ label: 'Working', since: '2026-09-13T12:00:09.000Z' });
  });

  it('shows the last run summary between turns, without an elapsed clock', () => {
    expect(activityLine({ activity: null, live: null, tests: { passed: 1, total: 1 } }, 'last turn summary')).toEqual({ label: 'last turn summary', since: null });
  });

  it('shows nothing with neither a current activity nor a run summary', () => {
    expect(activityLine({ activity: null, live: null, tests: null }, null)).toBeNull();
    expect(activityLine({ activity: null, live: null, tests: null }, undefined)).toBeNull();
    expect(activityLine(null, 'last turn summary')).toBeNull();
  });
});