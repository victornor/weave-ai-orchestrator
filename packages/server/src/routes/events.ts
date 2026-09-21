import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { EPHEMERAL_EVENT_TYPES, type WorkspaceEvent } from '@weave-ai/shared';
import type { AppEnv } from '../types.js';
import type { AppDeps } from '../types.js';
import { HEARTBEAT_MS, Pump, heartbeat, writeSse } from '../sse.js';

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
      const send = async (ev: WorkspaceEvent): Promise<boolean> => {
        if (isEphemeral(ev.type)) {
          // No `id`: an ephemeral frame carries no position, so a client's replay cursor stays put.
          return writeSse(stream, () => stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }));
        }
        cursor = ev.seq;
        return writeSse(stream, () => stream.writeSSE({ id: String(ev.seq), event: ev.type, data: JSON.stringify(ev) }));
      };
      try {
        for (;;) {
          const batch = bus.since(cursor, 500);
          for (const ev of batch) if (!(await send(ev))) return;
          if (batch.length < 500) break;
        }
        while (!pump.done) {
          await pump.wait(HEARTBEAT_MS);
          const pending = pump.drain().filter((ev) => isEphemeral(ev.type) || ev.seq > cursor).sort((a, b) => a.seq - b.seq);
          if (pending.length) { for (const ev of pending) if (!(await send(ev))) return; }
          else if (!pump.done) { if (!(await heartbeat(stream))) return; }
        }
      } finally {
        unsubscribe();
      }
    });
  });
  return app;
}

const MAX_CURSOR_BYTES = 8_192;

type GlobalFrame = { workspaceId: string; event: WorkspaceEvent };

/** Encode the independent workspace positions carried by a daemon-wide stream. */
export function encodeGlobalCursor(cursor: ReadonlyMap<string, number>): string {
  const value: Record<string, number> = {};
  for (const [workspaceId, seq] of cursor) value[workspaceId] = seq;
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseGlobalCursor(raw: string | undefined, workspaces: ReadonlyMap<string, unknown>): Map<string, number> | null {
  if (!raw || raw.length > MAX_CURSOR_BYTES) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const cursor = new Map<string, number>();
    for (const [workspaceId, seq] of Object.entries(value)) {
      if (!workspaces.has(workspaceId)) continue;
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null;
      cursor.set(workspaceId, seq);
    }
    return cursor;
  } catch {
    return null;
  }
}

/** `GET /api/events?after=<base64url cursor map>` — one SSE connection for all loaded workspaces. */
export function globalEventRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => {
    const workspaces = [...deps.workspaces.values()];
    const supplied = parseGlobalCursor(c.req.query('after'), deps.workspaces);
    const cursor = supplied ?? new Map<string, number>();
    for (const workspace of workspaces) {
      if (!cursor.has(workspace.id)) cursor.set(workspace.id, workspace.ctx.events.lastSeq());
    }

    return streamSSE(c, async (stream) => {
      const pump = new Pump<GlobalFrame>();
      const unsubscribers = workspaces.map((workspace) => workspace.ctx.events.on((event) => pump.push({ workspaceId: workspace.id, event })));
      stream.onAbort(() => pump.close());
      const send = async ({ workspaceId, event }: GlobalFrame): Promise<boolean> => {
        if (isEphemeral(event.type)) {
          return writeSse(stream, () => stream.writeSSE({ event: event.type, data: JSON.stringify(event) }));
        }
        const current = cursor.get(workspaceId) ?? 0;
        if (event.seq <= current) return true;
        cursor.set(workspaceId, event.seq);
        return writeSse(stream, () => stream.writeSSE({ id: encodeGlobalCursor(cursor), event: event.type, data: JSON.stringify(event) }));
      };
      try {
        // Every bus is subscribed before any replay starts, so an event emitted during replay is
        // queued and the cursor filter above prevents it being sent twice.
        for (const workspace of workspaces) {
          let batch: WorkspaceEvent[];
          do {
            batch = workspace.ctx.events.since(cursor.get(workspace.id) ?? 0, 500);
            for (const event of batch) if (!(await send({ workspaceId: workspace.id, event }))) return;
          } while (batch.length === 500 && !pump.done);
        }
        while (!pump.done) {
          await pump.wait(HEARTBEAT_MS);
          const pending = pump.drain().filter(({ workspaceId, event }) => isEphemeral(event.type) || event.seq > (cursor.get(workspaceId) ?? 0));
          for (const frame of pending) if (!(await send(frame))) return;
          if (!pending.length && !pump.done) { if (!(await heartbeat(stream))) return; }
        }
      } finally {
        for (const unsubscribe of unsubscribers) unsubscribe();
      }
    });
  });
  return app;
}
