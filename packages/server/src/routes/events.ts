import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { EPHEMERAL_EVENT_TYPES, type WorkspaceEvent } from '@weave-ai/shared';
import type { AppEnv } from '../types.js';
import { HEARTBEAT_MS, Pump, heartbeat } from '../sse.js';

/** A live-only frame (VS-328): forwarded to clients but never replayed, and it must not move the cursor. */
const isEphemeral = (type: string): boolean => (EPHEMERAL_EVENT_TYPES as readonly string[]).includes(type);

/**
 * `GET /api/w/:ws/events?after=<seq>` — durable outbox replay then live tail.
 * Frames carry `id: <seq>` so a reconnecting client resumes with `after` (or `Last-Event-ID`).
 */
export function eventRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => {
    const bus = c.get('ws').ctx.events;
    const lastEventId = c.req.header('last-event-id');
    // No cursor → tail only (a fresh client wants live changes, not the whole history); a cursor → replay from it.
    const rawAfter = c.req.query('after') ?? lastEventId;
    const after = rawAfter === undefined || rawAfter === null || rawAfter === '' ? bus.lastSeq() : (Number(rawAfter) || 0);

    return streamSSE(c, async (stream) => {
      const pump = new Pump<WorkspaceEvent>();
      const unsubscribe = bus.on((ev) => pump.push(ev));
      stream.onAbort(() => pump.close());
      let cursor = after;
      const send = async (ev: WorkspaceEvent): Promise<void> => {
        if (isEphemeral(ev.type)) {
          // No `id`: an ephemeral frame carries no position, so a client's replay cursor stays put.
          await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
          return;
        }
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
          const pending = pump.drain().filter((ev) => isEphemeral(ev.type) || ev.seq > cursor).sort((a, b) => a.seq - b.seq);
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
