import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { RunEvent } from '@agent-conductor/shared';
import type { AppEnv } from '../types.js';
import { streamSSE } from 'hono/streaming';
import { body, csv, query } from '../http.js';
import { HEARTBEAT_MS, Pump, heartbeat } from '../sse.js';

export function runRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const q = query(c, z.object({ agent: z.string().optional(), ticket: z.string().optional(), status: csv.optional(), limit: z.coerce.number().int().optional(), offset: z.coerce.number().int().optional() }));
    return c.json(c.get('ws').services.runs.list({ agentId: q.agent, ticketId: q.ticket, status: q.status as never, limit: q.limit, offset: q.offset }));
  });

  /**
   * What a set of runs did, counted (VS-74). Before `/:id`, or Hono would read `traces` as a run id.
   * The ids come as one `?ids=` list because the caller is labelling a page of chat history: one
   * request whatever the page holds.
   */
  app.get('/traces', (c) => {
    const q = query(c, z.object({ ids: csv.optional(), agent: z.string().optional(), since: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }));
    return c.json(c.get('ws').services.runs.traces({ ids: q.ids, agentId: q.agent, since: q.since, limit: q.limit }));
  });

  app.get('/:id', (c) => c.json(c.get('ws').services.runs.get(c.req.param('id'))));

  app.get('/:id/events', (c) => {
    const q = query(c, z.object({ after: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(2000).optional() }));
    return c.json(c.get('ws').services.runs.events(c.req.param('id'), q.after, q.limit));
  });

  app.get('/:id/events/stream', (c) => {
    const s = c.get('ws').services;
    const runId = c.req.param('id');
    const after = Number(c.req.query('after') ?? c.req.header('last-event-id') ?? 0) || 0;
    return streamSSE(c, async (stream) => {
      const pump = new Pump<RunEvent>();
      const unsubscribe = s.runs.onEvent((id, ev) => { if (id === runId) pump.push(ev); });
      stream.onAbort(() => pump.close());
      let cursor = after;
      const send = async (ev: RunEvent): Promise<void> => {
        cursor = ev.seq;
        await stream.writeSSE({ id: String(ev.seq), event: ev.type, data: JSON.stringify(ev) });
      };
      try {
        for (const ev of s.runs.events(runId, cursor)) await send(ev);
        while (!pump.done) {
          await pump.wait(HEARTBEAT_MS);
          const pending = pump.drain().filter((ev) => ev.seq > cursor).sort((a, b) => a.seq - b.seq);
          if (pending.length) { for (const ev of pending) await send(ev); }
          else if (!pump.done) await heartbeat(stream);
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.post('/:id/cancel', async (c) => {
    const { mode } = await body(c, z.object({ mode: z.enum(['interrupt', 'kill']).default('interrupt') }));
    await c.get('ws').services.runs.cancel(c.get('actor'), c.req.param('id'), mode);
    return c.json({ ok: true });
  });

  /** Raw jsonl run log straight off disk; empty (not 404) when the run kept no log. */
  app.get('/:id/log', async (c) => {
    const run = c.get('ws').services.runs.get(c.req.param('id'));
    if (!run.logPath) return c.text('', 200, { 'content-type': 'application/x-ndjson' });
    const text = await readFile(run.logPath, 'utf8').catch(() => '');
    return c.text(text, 200, { 'content-type': 'application/x-ndjson' });
  });

  return app;
}
