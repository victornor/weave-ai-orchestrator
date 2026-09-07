/**
 * The on-demand plan-limit sync (VS-84), as both surfaces that show plan limits drive it: the usage
 * page and the sheet behind the conductor chat's header meter. One hook so the two can never
 * disagree about what "too soon" or "that failed" looks like.
 *
 * The daemon never refuses a sync it made too soon — it answers with the current snapshot and when
 * the next one is allowed — so everything this returns is a message beside a runtime, never an
 * error state that hides the numbers.
 */
import { useCallback, useState } from 'react';
import type { PlanSync } from '../components/PlanLimits';
import { useSyncUsageAccounts } from '../api/hooks';

/** `retryAfterMs` written the way a human waits: whole seconds, never zero. */
function waitFor(retryAfterMs: number): string {
  return `${Math.max(1, Math.ceil(retryAfterMs / 1000))}s`;
}

export function usePlanSync(): PlanSync {
  const sync = useSyncUsageAccounts();
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [pendingRuntimeId, setPendingRuntimeId] = useState<string | null>(null);

  const onSync = useCallback((runtimeId: string) => {
    setPendingRuntimeId(runtimeId);
    // Clear this runtime's last message first: a second attempt must not read under the verdict of
    // the first one while it is still in flight.
    setMessages((prev) => { const { [runtimeId]: _gone, ...rest } = prev; return rest; });
    sync.mutate({ runtimeId }, {
      onSuccess: (out) => {
        const throttled = out.throttled.find((t) => t.runtimeId === runtimeId);
        const failed = out.failed.find((f) => f.runtimeId === runtimeId);
        const note = throttled
          ? `Synced too recently — try again in ${waitFor(throttled.retryAfterMs)}.`
          : failed ? `Sync failed — ${failed.message}` : null;
        if (note) setMessages((prev) => ({ ...prev, [runtimeId]: note }));
      },
      onError: (err: Error) => setMessages((prev) => ({ ...prev, [runtimeId]: `Sync failed — ${err.message}` })),
      onSettled: () => setPendingRuntimeId((id) => (id === runtimeId ? null : id)),
    });
  }, [sync]);

  return { pendingRuntimeId, messages, onSync };
}
