/**
 * A live worker's activity, as V2 shows it (VS-368). The daemon computes the summary and carries it
 * on the workers read; it also pushes a fresher one on the workspace stream. The stream is the
 * authority once it has spoken — the same precedence V1's board uses — so a stale query line cannot
 * outlive the turn that produced it.
 *
 * Kept pure and separate from the screens: both V2 Work and the V2 ticket page render the same
 * line, and neither should be able to disagree with the other about what a worker is doing.
 */
import type { TestTally, WorkerActivitySummary } from '@weave-ai/shared';

export interface LiveWorkerSummary {
  activity: WorkerActivitySummary['activity'];
  tests: TestTally | null;
}

export interface WorkerActivityFields {
  id: string;
  activity?: WorkerActivitySummary['activity'];
  tests?: TestTally | null;
}

/**
 * A worker's activity and test tally: the pushed frame if one has arrived for it, else the
 * workers-read row. A pushed frame wins entirely, including when its `activity` is null (the turn
 * ended) — falling back to the query's older line would show a stale activity the daemon cleared.
 */
export function mergeWorkerActivity(
  worker: WorkerActivityFields | null | undefined,
  pushed: ReadonlyMap<string, WorkerActivitySummary>,
): LiveWorkerSummary | null {
  if (!worker) return null;
  const override = pushed.get(worker.id);
  return {
    activity: override ? override.activity : worker.activity ?? null,
    tests: override ? override.tests : worker.tests ?? null,
  };
}

/**
 * The line to render for a live worker: its current activity, else the summary of the last run it
 * reported, else nothing. `since` is set only for a current activity, so the elapsed clock does not
 * keep ticking against a line that stopped being live.
 */
export function activityLine(
  summary: LiveWorkerSummary | null,
  lastRunSummary: string | null | undefined,
): { label: string; since: string | null } | null {
  if (!summary) return null;
  if (summary.activity) return { label: summary.activity.label, since: summary.activity.since };
  return lastRunSummary ? { label: lastRunSummary, since: null } : null;
}
