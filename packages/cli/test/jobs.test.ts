/**
 * VS-641: the job stream now carries a named `heartbeat` keepalive. `followJob` must ignore a frame
 * it does not recognise rather than treating it as the job finishing.
 */
import { describe, expect, it } from 'vitest';
import type { ApiClient, SseMessage } from '../src/api.js';
import { followJob } from '../src/jobs.js';

function harness(): { client: ApiClient; emit: (m: SseMessage) => void } {
  let handler: ((m: SseMessage) => void) | null = null;
  const client = {
    w: (path: string) => `/api/w/ws${path}`,
    stream: (_path: string, opts: { onMessage: (m: SseMessage) => void }) => {
      handler = opts.onMessage;
      return { close() {}, closed: false };
    },
  } as unknown as ApiClient;
  return { client, emit: (m) => handler?.(m) };
}

describe('followJob', () => {
  it('ignores a heartbeat frame and resolves on the finished frame', async () => {
    const h = harness();
    let settled = false;
    const pending = followJob(h.client, 'job1').then((job) => { settled = true; return job; });

    h.emit({ type: 'heartbeat', id: null, data: '{"at":"2026-09-21T00:00:00.000Z"}', json: { at: '2026-09-21T00:00:00.000Z' } });
    await Promise.resolve();
    expect(settled).toBe(false);

    const finished = { kind: 'finished', jobId: 'job1', seq: 3, job: { id: 'job1' } };
    h.emit({ type: 'job.finished', id: '3', data: JSON.stringify(finished), json: finished });
    await expect(pending).resolves.toEqual({ id: 'job1' });
  });
});
