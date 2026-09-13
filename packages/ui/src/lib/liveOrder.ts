/**
 * The Live pages' running-first cell order and its between-turns grace window (VS-337).
 *
 * The floor lists its cells newest-worker-first (`liveWorkingAgents`). A worker running a turn should
 * sit above workers that are only waiting for their next turn, but a turn that ends and a next turn
 * that starts moments later must not bounce the cell down and back. A worker therefore stays in the
 * running group for a short grace period after its run ends.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

/** How long a cell stays in the running group after its in-progress run ends (VS-337). */
export const LIVE_RUN_GRACE_MS = 10_000;

/** The fields the order reads; a global Live cell supplies its `agent`. */
export interface LiveOrderKey {
  id: string;
  createdAt: string;
}

/**
 * Newest-first, but every item in `runningIds` before every item that is not. Order within a group is
 * the floor's existing one (`createdAt` descending, id as the tie-break), so a cell only moves when
 * its worker changes group. Pure: the grace window that feeds `runningIds` lives in the hook below.
 */
export function orderByRunning<T>(
  items: readonly T[],
  key: (item: T) => LiveOrderKey,
  runningIds: ReadonlySet<string>,
): T[] {
  const rank = (item: T): number => (runningIds.has(key(item).id) ? 0 : 1);
  return [...items].sort((a, b) => {
    const group = rank(a) - rank(b);
    if (group !== 0) return group;
    const ka = key(a);
    const kb = key(b);
    return ka.createdAt < kb.createdAt ? 1 : ka.createdAt > kb.createdAt ? -1 : ka.id < kb.id ? -1 : ka.id > kb.id ? 1 : 0;
  });
}

/**
 * The ids that count as running for the order: those with an in-progress run, plus any whose run
 * ended within {@link LIVE_RUN_GRACE_MS}. A worker that becomes active again inside the window is
 * released from the hold at once, so its cell never leaves the running group during a handoff. The
 * hold is timer-driven, so the cell moves down on its own once the window elapses even if no further
 * run data arrives.
 */
export function useRunningWorkerIds(activeIds: ReadonlySet<string>): ReadonlySet<string> {
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const previous = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const added: string[] = [];
    const dropped: string[] = [];
    // A worker that just left the active set is held; a worker already being held is left alone.
    for (const id of previous.current) {
      if (activeIds.has(id) || timers.current.has(id)) continue;
      added.push(id);
      const timer = setTimeout(() => {
        timers.current.delete(id);
        setHeld((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, LIVE_RUN_GRACE_MS);
      timers.current.set(id, timer);
    }
    // A worker active again inside the window leaves the held set immediately.
    for (const id of activeIds) {
      const timer = timers.current.get(id);
      if (timer === undefined) continue;
      clearTimeout(timer);
      timers.current.delete(id);
      dropped.push(id);
    }
    previous.current = activeIds;
    if (added.length > 0 || dropped.length > 0) {
      setHeld((current) => {
        const next = new Set(current);
        for (const id of added) next.add(id);
        for (const id of dropped) next.delete(id);
        return next;
      });
    }
  }, [activeIds]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  return useMemo(() => {
    if (held.size === 0) return activeIds;
    const ids = new Set(activeIds);
    for (const id of held) if (!ids.has(id)) ids.add(id);
    return ids;
  }, [activeIds, held]);
}
