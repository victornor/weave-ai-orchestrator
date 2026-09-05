/**
 * The project-add contract and the job surface (VS-37): `POST /projects` answers before the clone
 * finishes, and the job it names is readable, listable and streamable.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Job } from '@agent-conductor/shared';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const HUMAN = { kind: 'human' as const, id: 'op1' };

/** Reads SSE frames until `count` `id:` lines have arrived, then cancels. */
async function readFrames(res: Response, count: number, timeoutMs = 4000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while ((buffer.match(/^id: /gm)?.length ?? 0) < count && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now())))]);
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return buffer;
}

describe('project add answers before the work finishes', () => {
  it('POST /projects is 202 with the cloning project and the job performing it', async () => {
    harness = makeHarness();
    const project = { id: 'p1', slug: 'api', status: 'cloning', defaultBranch: 'main' };
    harness.impls['projects']!['startAdd'] = () => {
      const job = harness!.runtime.services.jobs.start('project_add', { type: 'project', id: 'p1' }, HUMAN);
      return { project, jobId: job.id };
    };

    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/projects', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ url: 'git@github.com:acme/api.git' }),
    }));
    expect(res.status).toBe(202);
    const payload = await res.json() as { project: typeof project; jobId: string };
    expect(payload.project.status).toBe('cloning');
    expect(harness.runtime.services.jobs.get(payload.jobId).state).toBe('running');
  });

  it('POST /projects/:id/retry is 202, and passes a conflict through', async () => {
    harness = makeHarness();
    harness.impls['projects']!['retryAdd'] = (_actor: unknown, id: string) => {
      if (id === 'healthy') throw new (Object.assign(new Error('project healthy is ready, not error'), { code: 'conflict' }).constructor as never);
      const job = harness!.runtime.services.jobs.start('project_add', { type: 'project', id }, HUMAN);
      return { project: { id, status: 'cloning' }, jobId: job.id };
    };

    const ok = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/projects/p1/retry', { method: 'POST', headers: authed() }));
    expect(ok.status).toBe(202);
    expect((await ok.json() as { jobId: string }).jobId).toBeTruthy();
  });

  it('refuses the retry with the conflict core raised', async () => {
    harness = makeHarness();
    const { OcError } = await import('@agent-conductor/shared');
    harness.impls['projects']!['retryAdd'] = () => { throw new OcError('conflict', 'project api is ready, not error — there is nothing to retry'); };
    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/projects/api/retry', { method: 'POST', headers: authed() }));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('conflict');
  });
});

describe('job routes', () => {
  const startJob = (h: Harness): Job => h.runtime.services.jobs.start('project_add', { type: 'project', id: 'p1' }, HUMAN);

  it('reads one job with its steps and log tail', async () => {
    harness = makeHarness();
    const job = startJob(harness);
    harness.runtime.services.jobs.step(job.id, 'clone', 'running');
    harness.runtime.services.jobs.line(job.id, 'clone', 'stderr', 'Cloning into…');
    harness.runtime.services.jobs.step(job.id, 'clone', 'done');

    const res = await createApp(harness.deps).fetch(new Request(`http://127.0.0.1/api/w/ws1/jobs/${job.id}`, { headers: authed() }));
    expect(res.status).toBe(200);
    const body = await res.json() as Job;
    expect(body.steps[0]).toMatchObject({ id: 'clone', state: 'done' });
    expect(body.log[0]!.text).toBe('Cloning into…');
  });

  it('lists jobs for one project, filtered by kind', async () => {
    harness = makeHarness();
    const mine = startJob(harness);
    harness.runtime.services.jobs.start('project_add', { type: 'project', id: 'other' }, HUMAN);

    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/jobs?kind=project_add&entity=p1', { headers: authed() }));
    const body = await res.json() as Job[];
    expect(body.map((j) => j.id)).toEqual([mine.id]);
  });

  it('404s a job that does not exist', async () => {
    harness = makeHarness();
    const res = await createApp(harness.deps).fetch(new Request('http://127.0.0.1/api/w/ws1/jobs/nope', { headers: authed() }));
    expect(res.status).toBe(404);
  });

  it('replays the job so far and then tails it live', async () => {
    harness = makeHarness();
    const jobs = harness.runtime.services.jobs;
    const job = startJob(harness);
    jobs.step(job.id, 'clone', 'running');
    jobs.line(job.id, 'clone', 'stderr', 'receiving objects: 40%');

    const res = await createApp(harness.deps).fetch(new Request(`http://127.0.0.1/api/w/ws1/jobs/${job.id}/stream`, { headers: authed() }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // Six replayed steps + the retained line, then one more line produced while attached.
    const pending = readFrames(res, 8);
    setTimeout(() => jobs.line(job.id, 'clone', 'stderr', 'receiving objects: 100%'), 20);
    const text = await pending;

    expect(text).toContain('event: job.step');
    expect(text).toContain('receiving objects: 40%');
    expect(text).toContain('receiving objects: 100%');
    expect(text).toContain('id: 1');
    expect(text).toContain('id: 2');
  });

  it('resumes after ?after= without repeating the lines already seen', async () => {
    harness = makeHarness();
    const jobs = harness.runtime.services.jobs;
    const job = startJob(harness);
    jobs.step(job.id, 'clone', 'running');
    jobs.line(job.id, 'clone', 'stderr', 'first');
    jobs.line(job.id, 'clone', 'stderr', 'second');

    const res = await createApp(harness.deps).fetch(new Request(`http://127.0.0.1/api/w/ws1/jobs/${job.id}/stream?after=1`, { headers: authed() }));
    const text = await readFrames(res, 7);
    expect(text).toContain('second');
    expect(text).not.toContain('first');
  });

  it('closes the stream of a job that already finished, after replaying it', async () => {
    harness = makeHarness();
    const jobs = harness.runtime.services.jobs;
    const job = startJob(harness);
    jobs.step(job.id, 'clone', 'failed');
    jobs.line(job.id, 'clone', 'stderr', 'fatal: repository not found');
    jobs.finish(job.id, 'failed', { failedStep: 'clone', message: 'git clone failed' });

    const res = await createApp(harness.deps).fetch(new Request(`http://127.0.0.1/api/w/ws1/jobs/${job.id}/stream`, { headers: authed() }));
    const text = await res.text();
    expect(text).toContain('event: job.finished');
    expect(text).toContain('fatal: repository not found');
    expect(text).toContain('"failedStep":"clone"');
  });
});
