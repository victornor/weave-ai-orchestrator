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
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { RUN_EVENT_TYPES, type RunEvent } from '@agent-conductor/shared';
import { useWs } from './context';
import { useRunEvents } from './hooks';

const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000];

export function useRunEventStream(runId: string | null, { live = true }: { live?: boolean } = {}): RunEvent[] {
  const ws = useWs();
  const persisted = useRunEvents(runId ?? '');
  const [tail, setTail] = useState<RunEvent[]>([]);
  /** Highest seq rendered, so a reconnect asks for `?after=` it rather than replaying the turn. */
  const seq = useRef(0);

  useEffect(() => {
    setTail([]);
    seq.current = 0;
  }, [runId]);

  useEffect(() => {
    if (!runId || !live) return;
    let stopped = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const handle = (m: MessageEvent<string>): void => {
      let evt: RunEvent;
      try {
        evt = JSON.parse(m.data) as RunEvent;
      } catch {
        return;
      }
      if (!evt || typeof evt.seq !== 'number') return;
      seq.current = Math.max(seq.current, evt.seq);
      attempts = 0;
      setTail((xs) => (xs.some((x) => x.id === evt.id) ? xs : [...xs, evt]));
    };

    const open = (): void => {
      if (stopped) return;
      const after = seq.current ? `?after=${seq.current}` : '';
      const url = `/api/w/${encodeURIComponent(ws)}/runs/${encodeURIComponent(runId)}/events/stream${after}`;
      es = new EventSource(url, { withCredentials: true });
      es.onmessage = (m) => handle(m as MessageEvent<string>);
      // The daemon names every frame `event: <run event type>`; onmessage only sees unnamed frames.
      for (const type of RUN_EVENT_TYPES) es.addEventListener(type, (m) => handle(m as MessageEvent<string>));
      es.onerror = () => {
        es?.close();
        if (stopped) return;
        attempts += 1;
        timer = setTimeout(open, BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] ?? 15000);
      };
    };

    open();
    return () => {
      stopped = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [ws, runId, live]);

  return useMemo(() => {
    const out: RunEvent[] = [];
    const seen = new Set<string>();
    for (const e of [...(persisted.data ?? []), ...tail]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out.sort((a, b) => a.seq - b.seq);
  }, [persisted.data, tail]);
}
