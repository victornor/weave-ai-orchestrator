## Why

On 2026-09-10, VS-199's worker ended a turn having started `pnpm test` in the background, reporting
it would return to the result. Nothing ever woke it: a worker is woken by ticket events, conductor
messages and scheduled retries, never by a shell command completing in its own worktree. It sat
`active` with an unfinished ticket for twenty minutes before a human noticed.

The supervisor's existing watchdog (`packages/core/src/supervisor/index.ts:137-185`) could not have
caught this even in principle. It only inspects `runs` rows with `status = 'running'` — VS-199's run
had already finished `succeeded`; the turn did not hang, it simply completed and was never re-woken.
And had the run still been live, the watchdog's own worktree-touched deferral
(`index.ts:151-154`) would have kept deferring it forever, because the very background job the
worker was wrongly waiting on writes to the worktree continuously. The two blind spots compound: the
thing that caused the stall is also the thing that would mask it from the one check built to notice
stuck work.

A stalled worker of this shape — one turn ended cleanly, nothing left to wake it, its ticket still
open — is invisible today. Nothing in the periodic sweep looks for it.

## What Changes

- Add a new periodic supervisor check, alongside the existing watchdog rather than inside it: a
  worker agent that is not retired, whose ticket is not in a terminal status, that has no open
  decision, no queued or claimed wakeup, and no run queued or running, and whose `agents.last_run_at`
  is older than a fixed threshold, is flagged as stalled.
- On a match, raise it through the existing fault-surfacing pattern: a `worker.stalled` event (already
  a member of the supervisor's conductor-digest event set) plus a warning log line, so the conductor
  sees it on its next digest and a human sees it in the ticket/agent record. No new channel.
- Nothing is auto-resumed. The check only surfaces the condition; steering or relaunching the worker
  stays a decision for the conductor or a human.
- The existing live-run watchdog (timeout/silence interrupt, the worktree-touched deferral, its
  retry-once behaviour) is untouched — this is an additional, independent check reading different rows
  (`agents`/`tickets`/`decisions`/`wakeups` instead of `runs`), not a change to it.

## Capabilities

### New Capabilities

- `worker-supervision/stalled-worker-detection`: what counts as a stalled worker (idle but
  unfinished, with nothing left that could wake it) independent of run liveness, the threshold, and
  what does not count (mid-run, awaiting a decision, a wake already queued, a terminal ticket).

### Modified Capabilities

(none — the existing watchdog's requirements are unchanged; this adds a new, independent check.)

## Impact

- `packages/core/src/supervisor/index.ts` — a new `stalledWorkerScan` (or similarly named) pass added
  to the periodic sweep, alongside `livenessScan`/`approvalIntegrityScan`.
- `packages/shared/src/config.ts` — a new `WorkspaceDefaultsSchema` field for the stall threshold.
- `packages/core/src/supervisor/supervisor.test.ts` — coverage for the VS-199 shape and the healthy
  states that must not be flagged.
- No migration: every column the check reads (`agents.last_run_at`, `agents.status`, `tickets.status`,
  `decisions.status`, `wakeups.status`, `runs.status`) already exists.
