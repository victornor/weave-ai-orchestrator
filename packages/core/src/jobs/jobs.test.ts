import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@agent-conductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import type { WorkspaceContext } from '../context.js';
import { createJobsService, JOB_LOG_FLUSH_MS, JOB_LOG_LINES } from './index.js';
import type { Actor, JobsService, JobStreamItem } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };

describe('jobs', () => {
  let h: TestHarness;
  let jobs: JobsService;

  beforeEach(() => {
    h = makeHarness({ bare: true });
    jobs = createJobsService(h.ctx, h.deps);
  });
  afterEach(async () => { await jobs.stop(); h.cleanup(); });

  const start = (): string => jobs.start('project_add', { type: 'project', id: 'p1' }, HUMAN).id;

  it('seeds the whole step list as pending so the sequence is known before it runs', () => {
    const job = jobs.get(start());
    expect(job.state).toBe('running');
    expect(job.steps.map((s) => s.id)).toEqual(['clone', 'resolve_branch', 'declare', 'openspec', 'knowledge', 'ticket']);
    expect(job.steps.every((s) => s.state === 'pending' && s.startedAt === null)).toBe(true);
    expect(job.steps[0]!.label).toBe('Clone the repository');
  });

  it('times each step and keeps both ends once it has finished', () => {
    const id = start();
    jobs.step(id, 'clone', 'running');
    expect(jobs.get(id).steps[0]!.startedAt).toBeTruthy();
    jobs.step(id, 'clone', 'done');
    const step = jobs.get(id).steps[0]!;
    expect(step.state).toBe('done');
    expect(step.startedAt).toBeTruthy();
    expect(step.endedAt).toBeTruthy();
  });

  it('fails the job with the failing step and leaves the later steps pending', () => {
    const id = start();
    jobs.step(id, 'clone', 'failed');
    const job = jobs.finish(id, 'failed', { failedStep: 'clone', message: 'git clone failed' });
    expect(job.state).toBe('failed');
    expect(job.failedStep).toBe('clone');
    expect(job.message).toBe('git clone failed');
    expect(job.steps.filter((s) => s.state === 'pending').map((s) => s.id)).toEqual(['resolve_branch', 'declare', 'openspec', 'knowledge', 'ticket']);
  });

  it('keeps only the most recent lines but never repeats a sequence number', () => {
    const id = start();
    jobs.step(id, 'clone', 'running');
    for (let i = 1; i <= JOB_LOG_LINES + 50; i++) jobs.line(id, 'clone', 'stderr', `line ${i}`);
    jobs.step(id, 'clone', 'done');   // a transition always flushes the tail to the row
    const job = jobs.get(id);
    expect(job.log).toHaveLength(JOB_LOG_LINES);
    expect(job.log[0]!.text).toBe('line 51');
    expect(job.log.at(-1)!.text).toBe(`line ${JOB_LOG_LINES + 50}`);
    expect(job.log.at(-1)!.seq).toBe(JOB_LOG_LINES + 50);
    expect(job.logSeq).toBe(JOB_LOG_LINES + 50);
  });

  it('puts the start and the finish on the outbox and nothing per line', async () => {
    const id = start();
    for (let i = 0; i < 20; i++) jobs.line(id, 'clone', 'stdout', `noise ${i}`);
    jobs.finish(id, 'done');
    await new Promise((r) => setTimeout(r, 0));   // the outbox fans out on a microtask
    const types = h.events.map((e) => e.type);
    expect(types.filter((t) => t === 'job.started')).toHaveLength(1);
    expect(types.filter((t) => t === 'job.finished')).toHaveLength(1);
    expect(types).toHaveLength(2);
  });

  it('publishes steps, lines and the finish to a subscriber, synchronously', () => {
    const items: JobStreamItem[] = [];
    const off = jobs.onItem((i) => items.push(i));
    const id = start();
    jobs.step(id, 'clone', 'running');
    jobs.line(id, 'clone', 'stderr', 'Cloning into…');
    jobs.finish(id, 'done');
    off();
    expect(items.map((i) => i.kind)).toEqual(['step', 'log', 'finished']);
    const line = items[1];
    expect(line?.kind === 'log' && line.line.text).toBe('Cloning into…');
    expect(items[2]?.seq).toBe(1);
  });

  it('lists a project\'s jobs newest first and reports the one still running', () => {
    const first = start();
    jobs.finish(first, 'done');
    expect(jobs.running('p1')).toBeNull();
    const second = start();
    expect(jobs.running('p1')?.id).toBe(second);
    expect(jobs.list({ entityId: 'p1' }).map((j) => j.id)).toEqual([second, first]);
    expect(jobs.list({ kind: 'project_add' })).toHaveLength(2);
    expect(jobs.list({ entityId: 'other' })).toHaveLength(0);
  });

  it('lists two jobs that share a start millisecond in creation order', () => {
    const first = start();
    const second = start();
    const at = '2026-09-11T12:00:00.000Z';
    h.db.run('UPDATE jobs SET started_at = ? WHERE id IN (?, ?)', [at, first, second]);
    expect(jobs.list({ entityId: 'p1' }).map((j) => j.id)).toEqual([second, first]);
    expect(jobs.list({ entityId: 'p1' }).map((j) => j.id)).toEqual([second, first]);
  });

  it('fails a job left running by a previous process', () => {
    const id = start();
    jobs.step(id, 'clone', 'running');
    createJobsService(h.ctx, h.deps).reconcile();
    const job = jobs.get(id);
    expect(job.state).toBe('failed');
    expect(job.failedStep).toBe('clone');
    expect(job.message).toMatch(/daemon stopped/);
    expect(job.steps[0]!.state).toBe('failed');
  });
});

/**
 * VS-57: the deferred write behind the flush cadence must never reach a database the process has
 * already closed — a timer that fires then is an uncaught exception, not a failed write.
 */
describe('job log flushes are drained, not abandoned', () => {
  let h: TestHarness;
  let jobs: JobsService;
  let warnings: Array<{ fields: Record<string, unknown>; msg: string }>;

  beforeEach(() => {
    h = makeHarness({ bare: true });
    warnings = [];
    // The service takes its logger once, at creation: give it one that records instead of printing.
    const record = warnings;
    h.ctx.log = (() => ({
      info: () => undefined,
      debug: () => undefined,
      error: () => undefined,
      warn: (fields: Record<string, unknown>, msg: string) => { record.push({ fields, msg }); },
    })) as unknown as WorkspaceContext['log'];
    jobs = createJobsService(h.ctx, h.deps);
  });
  afterEach(async () => { await jobs.stop(); h.cleanup(); });

  const start = (): string => jobs.start('project_add', { type: 'project', id: 'p1' }, HUMAN).id;
  /** The row as written, not the hydrated read: `get` merges the in-memory tail over it. */
  const row = (id: string): Job => h.db.get<Job>('SELECT * FROM jobs WHERE id = ?', [id])!;
  const settle = (): Promise<unknown> => new Promise((r) => setTimeout(r, JOB_LOG_FLUSH_MS * 3));

  it('writes the tail to the row once the flush delay has passed', async () => {
    const id = start();
    jobs.line(id, 'clone', 'stderr', 'receiving objects: 40%');

    // Before the delay the line is only in memory — which is what the hydrated read is for.
    expect(row(id).log).toEqual([]);
    expect(jobs.get(id).log[0]!.text).toBe('receiving objects: 40%');

    await settle();
    expect(row(id).log[0]!.text).toBe('receiving objects: 40%');
    expect(row(id).logSeq).toBe(1);
  });

  it('stop() writes a tail that has not been flushed yet', async () => {
    const id = start();
    jobs.line(id, 'clone', 'stderr', 'first');
    jobs.line(id, 'clone', 'stderr', 'second');
    expect(row(id).log).toEqual([]);

    await jobs.stop();

    expect(row(id).log.map((l) => l.text)).toEqual(['first', 'second']);
    expect(row(id).logSeq).toBe(2);
  });

  it('stop() leaves no timer that could fire against a closed database', async () => {
    const id = start();
    jobs.line(id, 'clone', 'stderr', 'receiving objects: 40%');
    await jobs.stop();
    h.db.close();

    // A line after the drain still reaches the in-memory tail and the stream, and arms nothing.
    expect(() => jobs.line(id, 'clone', 'stderr', 'too late')).not.toThrow();
    await settle();
    expect(warnings).toEqual([]);
  });

  it('a flush against a closed database warns instead of throwing out of the timer', async () => {
    const id = start();
    jobs.line(id, 'clone', 'stderr', 'receiving objects: 40%');
    h.db.close();

    await settle();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.fields['jobId']).toBe(id);
    expect(warnings[0]!.msg).toContain('job log flush failed');
  });
});
