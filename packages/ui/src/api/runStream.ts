/**
 * Live view of one run's events: the rows the API already has, plus the SSE tail from
 * `GET /api/w/:ws/runs/:id/events/stream`.
 *
 * The endpoint replays before it tails, so a surface that mounts mid-turn gets the whole turn
 * without a separate catch-up path, and a reconnect resumes from the highest `seq` seen. Frames
 * are de-duplicated by event id, because the replay overlaps whatever the query already returned.
 *
 * A finished run has no tail to follow: `live: false` keeps the persisted query and opens no
 * stream, so the same hook serves a turn being watched and a turn being read back, and a turn that
 * finishes under a surface simply stops streaming while keeping everything it already showed.
 *
 * The connection state and manual retry come from `useLiveStream` (`sseStream.ts`), the same
 * state machine the workspace event stream uses. See `live-streams/connection-state`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { RUN_EVENT_TYPES, type RunEvent } from '@weave-ai/shared';
import { useHookWs } from './context';
import { useRunEvents } from './hooks';
import { useLiveStream } from './sseStream';
import type { ConnectionStatus } from './sseStream';

export interface RunEventStream {
  events: RunEvent[];
  status: ConnectionStatus;
  retryNow: () => void;
}

export function useRunEventStream(runId: string | null, { live = true, ws: wsOverride }: { live?: boolean; ws?: string } = {}): RunEventStream {
  const ws = useHookWs(wsOverride);
  const persisted = useRunEvents(runId ?? '', 0, wsOverride);
  const [tail, setTail] = useState<RunEvent[]>([]);
  /** Highest seq rendered, so a reconnect asks for `?after=` it rather than replaying the turn. */
  const seq = useRef(0);
  /** `null` while there is nothing to stream, so `useLiveStream` opens and retries nothing. */
  const active = live && runId ? runId : null;

  useEffect(() => {
    setTail([]);
    seq.current = 0;
  }, [runId]);

  const { status, retryNow } = useLiveStream({
    resetKey: active,
    eventTypes: RUN_EVENT_TYPES,
    buildUrl: () => {
      if (!active) return null;
      const after = seq.current ? `?after=${seq.current}` : '';
      return `/api/w/${encodeURIComponent(ws)}/runs/${encodeURIComponent(active)}/events/stream${after}`;
    },
    onFrame: (m) => {
      let evt: RunEvent;
      try {
        evt = JSON.parse(m.data) as RunEvent;
      } catch {
        return;
      }
      if (!evt || typeof evt.seq !== 'number') return;
      seq.current = Math.max(seq.current, evt.seq);
      setTail((xs) => (xs.some((x) => x.id === evt.id) ? xs : [...xs, evt]));
    },
  });

  const events = useMemo(() => {
    const out: RunEvent[] = [];
    const seen = new Set<string>();
    for (const e of [...(persisted.data ?? []), ...tail]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out.sort((a, b) => a.seq - b.seq);
  }, [persisted.data, tail]);

  return { events, status, retryNow };
}
