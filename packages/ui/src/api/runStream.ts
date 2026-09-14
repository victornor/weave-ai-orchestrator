/**
 * Live view of one run's events: the rows the API already has, plus that run's `run.event` frames
 * from the shared workspace stream (VS-417).
 *
 * A run's events are live-only frames on the workspace event stream (`api/streams.ts`), not a
 * dedicated `EventSource`, so every live run a page shows rides the one connection per workspace —
 * a grid of tiles can no longer exhaust the browser's per-origin limit. The persisted rows come
 * from `GET /runs/:id/events`; the live tail and the read are merged by `seq`, because the two
 * disagree on `id` (see `mergeRunEvents`).
 *
 * A finished run has no tail to follow: `live: false` keeps the persisted query and attaches
 * nothing, so the same hook serves a turn being watched and a turn being read back. `newest` reads
 * a finished run's last events rather than its first (VS-332).
 *
 * The connection state and manual retry come from the shared `EventStream`, the same state machine
 * the workspace event stream uses. A frame missed while the stream was down is recovered by
 * re-reading the run's persisted events on reconnect.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunEvent } from '@weave-ai/shared';
import { useHookWs } from './context';
import { useRunEvents } from './hooks';
import { qk } from './keys';
import type { EventStream, ConnectionStatus } from './events';
import { acquireWorkspaceStream, releaseWorkspaceStream, useStreamQueryClient } from './streams';

export interface RunEventStream {
  events: RunEvent[];
  status: ConnectionStatus;
  retryNow: () => void;
}

/**
 * Merge a run's persisted events with its live tail, de-duplicating by `seq` rather than `id`.
 *
 * The two sources do not agree on `id`: a persisted row's `id` is `run_events`' real database
 * primary key (`GET /runs/:id/events`), while a live emission carries `id: String(seq)` — a
 * per-run counter, never the row's real id (`packages/core/src/runs/engine.ts`'s `record()`).
 * `seq` is the one field both sides actually agree on, and the table's own `UNIQUE (run_id, seq)`
 * constraint guarantees it is unique per run (VS-319) — both inputs here are always one run's
 * events, so `seq` alone, with no `runId` pairing, is enough.
 */
export function mergeRunEvents(persisted: readonly RunEvent[], live: readonly RunEvent[]): RunEvent[] {
  const out: RunEvent[] = [];
  const seen = new Set<number>();
  for (const e of [...persisted, ...live]) {
    if (seen.has(e.seq)) continue;
    seen.add(e.seq);
    out.push(e);
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export function useRunEventStream(runId: string | null, { live = true, newest = false, ws: wsOverride }: { live?: boolean; newest?: boolean; ws?: string } = {}): RunEventStream {
  const ws = useHookWs(wsOverride);
  const qc = useStreamQueryClient();
  const persisted = useRunEvents(runId ?? '', 0, wsOverride, { newest });
  const [tail, setTail] = useState<RunEvent[]>([]);
  /** Highest seq rendered, so a reconnect asks the read for everything after it. */
  const seq = useRef(0);
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'connecting', capturedAt: null, attempts: 0 });
  const streamRef = useRef<EventStream | null>(null);

  useEffect(() => {
    setTail([]);
    seq.current = 0;
  }, [runId]);

  useEffect(() => {
    if (!runId || !ws || !live) {
      streamRef.current = null;
      return;
    }
    const stream = acquireWorkspaceStream(ws, qc);
    streamRef.current = stream;
    setStatus(stream.getStatus());
    let connectedBefore = false;
    const offStatus = stream.subscribe((next) => {
      setStatus(next);
      if (next.state !== 'connected') return;
      // A reconnect can have dropped `run.event` frames; the persisted read behind them is
      // authoritative, so refetch this run's events once the stream is back (not on first connect,
      // where the query already holds them).
      if (connectedBefore) void qc.invalidateQueries({ queryKey: qk.runEvents(ws, runId) });
      connectedBefore = true;
    });
    const offFrame = stream.onEvent((e) => {
      if (String(e.type) !== 'run.event') return;
      const p = e.payload as { runId?: string; event?: RunEvent } | null;
      const evt = p?.event;
      if (!evt || (p.runId && p.runId !== runId) || typeof evt.seq !== 'number') return;
      seq.current = Math.max(seq.current, evt.seq);
      setTail((xs) => (xs.some((x) => x.id === evt.id) ? xs : [...xs, evt]));
    });
    return () => {
      offStatus();
      offFrame();
      streamRef.current = null;
      releaseWorkspaceStream(ws);
    };
  }, [runId, ws, live, qc]);

  const events = useMemo(() => mergeRunEvents(persisted.data ?? [], tail), [persisted.data, tail]);

  return { events, status, retryNow: () => streamRef.current?.retryNow() };
}
