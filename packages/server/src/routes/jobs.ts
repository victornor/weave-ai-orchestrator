/**
 * Jobs: the long-running workspace-setup operations a surface watches while they run (VS-37).
 *
 * `GET /jobs/:id/stream` is `runs/:id/events/stream` re-pointed — replay the record, then tail —
 * because both consumers already speak that shape: the web app's `EventSource` and the CLI's
 * `client.stream`.
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { JOB_KINDS } from '@weave-ai/shared';
import type { JobStreamItem } from '@weave-ai/core';
import type { AppEnv } from '../types.js';
import { query } from '../http.js';
import { HEARTBEAT_MS, Pump, heartbeat, writeSse } from '../sse.js';

export function jobRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const q = query(c, z.object({ kind: z.enum(JOB_KINDS).optional(), entity: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }));
    return c.json(c.get('ws').services.jobs.list({ kind: q.kind, entityId: q.entity, limit: q.limit }));
  });

  app.get('/:id', (c) => c.json(c.get('ws').services.jobs.get(c.req.param('id'))));

  app.get('/:id/stream', (c) => {
    const jobs = c.get('ws').services.jobs;
    const jobId = c.req.param('id');
    const after = Number(c.req.query('after') ?? c.req.header('last-event-id') ?? 0) || 0;
    jobs.get(jobId);   // 404 before the stream opens, rather than an empty one

    return streamSSE(c, async (stream) => {
      const pump = new Pump<JobStreamItem>();
      const unsubscribe = jobs.onItem((item) => { if (item.jobId === jobId) pump.push(item); });
      stream.onAbort(() => pump.close());
      // Read only once subscribed: a line published between the read and the subscription is a line
      // that is in neither the replay nor the tail.
      const job = jobs.get(jobId);
      let cursor = after;
      const send = async (item: JobStreamItem): Promise<boolean> => {
        cursor = Math.max(cursor, item.seq);
        return writeSse(stream, () => stream.writeSSE({ id: String(item.seq), event: `job.${item.kind}`, data: JSON.stringify(item) }));
      };
      try {
        // The replay: every sub-step as it stands, then the retained lines the client has not seen.
        for (const step of job.steps) if (!(await send({ kind: 'step', jobId, step, seq: cursor }))) return;
        for (const line of job.log) if (line.seq > after) { if (!(await send({ kind: 'log', jobId, line, seq: line.seq }))) return; }
        if (job.state !== 'running') { await send({ kind: 'finished', jobId, job, seq: job.logSeq }); return; }

        while (!pump.done) {
          await pump.wait(HEARTBEAT_MS);
          const pending = pump.drain();
          if (pending.length) {
            for (const item of pending) {
              if (item.kind === 'log' && item.seq <= cursor) continue;   // already replayed
              if (!(await send(item))) return;
            }
            if (pending.some((i) => i.kind === 'finished')) return;
          } else if (!pump.done) { if (!(await heartbeat(stream))) return; }
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return app;
}
