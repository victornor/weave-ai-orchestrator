/**
 * Reading a `RunEvent` off an SSE frame (VS-603).
 *
 * `GET /runs/:id/events/stream` sends a bare `RunEvent` as the frame's `data` (see
 * `packages/server/src/routes/runs.ts`), which has its own `payload` field — so unwrapping naively
 * on `'payload' in raw` takes the event's payload for the event and silently drops every live event.
 * A wrapped frame (`{ payload: RunEvent }`) is still accepted for transports that use one.
 */
import type { RunEvent } from '@weave-ai/shared';

export function runEventFromFrame(raw: unknown): RunEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj['seq'] === 'number' && typeof obj['type'] === 'string') return raw as RunEvent;
  const inner = obj['payload'];
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const nested = inner as Record<string, unknown>;
    if (typeof nested['seq'] === 'number' && typeof nested['type'] === 'string') return inner as RunEvent;
  }
  return null;
}
