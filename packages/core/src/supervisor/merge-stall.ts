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
 * With no per-check detail at all (no run, or a forge that reports none) the slot's own age against
 * `queuedGraceMs` is the only evidence there is, as before.
 */
import type { ForgeCheck } from '@weave-ai/plugin-sdk';

/** GitHub's maximum job execution time for hosted runners (360 minutes); a running job past it is hung. */
export const GITHUB_JOB_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export type MergeStallVerdict =
  | { stuck: false }
  | { stuck: true; kind: 'no_run' | 'not_started' | 'past_job_timeout'; checks: string[] };

export function judgeMergeChecks(input: { checks: ForgeCheck[] | null; slotStartedAtMs: number; nowMs: number; queuedGraceMs: number; jobTimeoutMs?: number }): MergeStallVerdict {
  const { checks, slotStartedAtMs, nowMs, queuedGraceMs } = input;
  const jobTimeoutMs = input.jobTimeoutMs ?? GITHUB_JOB_TIMEOUT_MS;
  const pending = (checks ?? []).filter((c) => c.state === 'pending');
  if (pending.length === 0) {
    // Nothing pending by name: no run, or everything skipped/cancelled. The slot's age is the evidence.
    return nowMs - slotStartedAtMs >= queuedGraceMs ? { stuck: true, kind: 'no_run', checks: [] } : { stuck: false };
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
