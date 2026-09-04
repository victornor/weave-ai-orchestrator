import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { WorkspaceEvent } from '@openconductor/shared';
import type { AppEnv } from '../types.js';
import { HEARTBEAT_MS, Pump, heartbeat } from '../sse.js';

/**
 * `GET /api/w/:ws/events?after=<seq>` — durable outbox replay then live tail.
 * Frames carry `id: <seq>` so a reconnecting client resumes with `after` (or `Last-Event-ID`).
 */
export function eventRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => {
    const bus = c.get('ws').ctx.events;
    const lastEventId = c.req.header('last-event-id');
    const after = Number(c.req.query('after') ?? lastEventId ?? 0) || 0;

    return streamSSE(c, async (stream) => {
      const pump = new Pump<WorkspaceEvent>();
      const unsubscribe = bus.on((ev) => pump.push(ev));
      stream.onAbort(() => pump.close());
      let cursor = after;
      const send = async (ev: WorkspaceEvent): Promise<void> => {
        cursor = ev.seq;
        await stream.writeSSE({ id: String(ev.seq), event: ev.type, data: JSON.stringify(ev) });
      };
      try {
        for (;;) {
          const batch = bus.since(cursor, 500);
          for (const ev of batch) await send(ev);
          if (batch.length < 500) break;
        }
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
  return app;
}
