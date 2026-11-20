/**
 * VS-991: is a merge-slot holder's pending CI stuck, or just slow? Pure — the supervisor feeds it the
 * rollup by name and acts on the verdict.
 *
 * A fixed "N minutes with checks unresolved" fires on every healthy repository whose suite takes
 * longer than N (FanStack's 25–37 min `dotnet-tests` against a 20 min alarm). So each pending check
 * is judged on its own:
 *   - a check that is RUNNING is hung only once it has outlived GitHub's own job limit — until then
 *     it is simply slow and says nothing;
 *   - a check that is QUEUED (or has no recorded start) is stuck once it has waited `queuedGraceMs`
 *     for a runner — measured from the slot's start when the forge gives no queue time.
 * With no pending check at all (no run, a forge that reports none, or a head whose checks do not exist
 * yet) `no_run` needs the current head to have been observed without checks for `queuedGraceMs`,
 * measured from the later of the slot's start and the head's first observation (VS-993).
 */
import type { ForgeCheck } from '@weave-ai/plugin-sdk';

/** GitHub's maximum job execution time for hosted runners (360 minutes); a running job past it is hung. */
export const GITHUB_JOB_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export type MergeStallVerdict =
  | { stuck: false }
  | { stuck: true; kind: 'no_run' | 'not_started' | 'past_job_timeout'; checks: string[] };

export function judgeMergeChecks(input: { checks: ForgeCheck[] | null; slotStartedAtMs: number; nowMs: number; queuedGraceMs: number; jobTimeoutMs?: number; headObservedAtMs?: number }): MergeStallVerdict {
  const { checks, slotStartedAtMs, nowMs, queuedGraceMs } = input;
  const jobTimeoutMs = input.jobTimeoutMs ?? GITHUB_JOB_TIMEOUT_MS;
  const pending = (checks ?? []).filter((c) => c.state === 'pending');
  if (pending.length === 0) {
    // Nothing pending by name: no run, or everything skipped/cancelled, or (VS-993) a head whose checks
    // are not created yet. The evidence is how long the CURRENT head has had none — not the slot's age,
    // which is long past the grace whenever the daemon's archive commit moves the head mid-landing.
    const since = Number.isFinite(input.headObservedAtMs) ? Math.max(slotStartedAtMs, input.headObservedAtMs as number) : slotStartedAtMs;
    return nowMs - since >= queuedGraceMs ? { stuck: true, kind: 'no_run', checks: [] } : { stuck: false };
  }
  const notStarted: string[] = [];
  const overTimeout: string[] = [];
  for (const c of pending) {
    const startedAt = c.startedAt ? Date.parse(c.startedAt) : NaN;
    const running = c.status === 'IN_PROGRESS' && Number.isFinite(startedAt);
    if (running) {
      if (nowMs - startedAt >= jobTimeoutMs) overTimeout.push(c.name);
    } else {
      const since = Number.isFinite(startedAt) ? startedAt : slotStartedAtMs;
      if (nowMs - since >= queuedGraceMs) notStarted.push(c.name);
    }
  }
  if (overTimeout.length > 0) return { stuck: true, kind: 'past_job_timeout', checks: overTimeout };
  if (notStarted.length > 0) return { stuck: true, kind: 'not_started', checks: notStarted };
  return { stuck: false };
}
