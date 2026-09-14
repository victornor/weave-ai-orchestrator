/**
 * The live per-worker activity summaries the daemon pushes on the workspace stream (VS-328), for
 * V2's Work and ticket screens (VS-368). The workers read is the base a fresh load reads; each
 * frame patches one worker's entry, coalesced to one state update per animation frame so a burst of
 * tool calls cannot re-render a board many times a second. No run-event stream is opened per card.
 */
import { useEffect, useRef, useState } from 'react';
import type { WorkerActivitySummary } from '@weave-ai/shared';
import { useWorkspaceEvents } from './context';

export function useWorkerActivity(): ReadonlyMap<string, WorkerActivitySummary> {
  const [summaries, setSummaries] = useState<Map<string, WorkerActivitySummary>>(new Map());
  const pending = useRef<Map<string, WorkerActivitySummary>>(new Map());
  const frame = useRef<number | null>(null);

  useWorkspaceEvents((e) => {
    if (String(e.type) !== 'worker.activity') return;
    const summary = e.payload as WorkerActivitySummary;
    if (!summary?.agentId) return;
    pending.current.set(summary.agentId, summary);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const batch = pending.current;
      pending.current = new Map();
      setSummaries((prev) => {
        const next = new Map(prev);
        for (const [id, s] of batch) next.set(id, s);
        return next;
      });
    });
  });

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  return summaries;
}
