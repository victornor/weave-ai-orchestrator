/**
 * VS-667: reconcile a workspace's worker read from the daemon-wide stream on a global page.
 *
 * A global page has no `WorkspaceProvider`, so the shell holds only the multiplexed daemon-wide
 * `GlobalEventStream`. Durable frames (`run.started`, `worker.status`) already invalidate the right
 * workspace's worker list through `invalidateFor`, but a live-only `worker.activity` summary carries
 * no sequence and invalidates nothing — so on a global page a worker joining or leaving the working
 * set can be the only signal the document gets, and the rail's Live badge would stay stale until a
 * navigation. This consumer watches those frames and re-reads the frame's own workspace at most once
 * per animation frame, and only when the frame's live-ness disagrees with what that read holds. It
 * opens no connection of its own: `useGlobalEvents` reserves the one shared entry the shell already
 * holds. Workspace pages are left to their own stream and the durable invalidations.
 */
import { useEffect, useRef } from 'react';
import type { Agent, WorkerActivitySummary, WorkspaceEvent } from '@weave-ai/shared';
import { useGlobalEvents } from '../api/context';
import { useStreamQueryClient } from '../api/streams';
import { qk } from '../api/keys';
import { workerFrameNeedsResync } from '../lib/workerLiveSync';

export function GlobalWorkerSync(): null {
  const qc = useStreamQueryClient();
  const pending = useRef<Set<string>>(new Set());
  const frame = useRef<number | null>(null);

  const flush = (): void => {
    frame.current = null;
    const workspaces = pending.current;
    pending.current = new Set();
    for (const ws of workspaces) void qc.invalidateQueries({ queryKey: [...qk.workers(ws), {}] });
  };
  const schedule = (): void => {
    if (frame.current !== null) return;
    frame.current = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
  };

  useGlobalEvents((e: WorkspaceEvent) => {
    if (String(e.type) !== 'worker.activity') return;
    const summary = e.payload as WorkerActivitySummary | null;
    if (!summary?.agentId) return;
    const cached = qc.getQueryData<readonly Pick<Agent, 'id' | 'status'>[]>([...qk.workers(e.workspaceId), {}]);
    if (!workerFrameNeedsResync(summary, cached)) return;
    pending.current.add(e.workspaceId);
    schedule();
  });

  useEffect(
    () => () => {
      if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  return null;
}
