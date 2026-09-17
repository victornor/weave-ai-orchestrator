## Why

VS-498's bounded stall recovery landed on 2026-09-17 and immediately mis-read a worker that was
waiting correctly. Seven tickets entered the merge queue at once; the queue admits one per project,
so six waited. A waiting ticket is `merging` with `merge_started_at` null, has no queued wake (the
queue wakes it when a slot frees) and no running run — so `stalledWorkers()` matched it, nudged the
worker twice, and raised a `gate_finding` to the weaver for a worker whose only correct action was to
wait. That is precisely the busiest moment (several tickets landing together), and a detector that
cries wolf there is one the weaver learns to dismiss, so the genuine stranded worker it was built for
goes back to being invisible.

## What Changes

- The stalled-worker predicate (`stalledWorkers()` in `packages/core/src/supervisor/index.ts`)
  excludes a worker whose ticket is `merging` and still waiting for merge-queue admission
  (`merge_started_at IS NULL`). This is the queue's own "waiting" state and the same narrow condition
  `spawnPending()` already uses to leave such a ticket unstaffed until it is admitted.
- A worker that holds the slot (`merging` with `merge_started_at IS NOT NULL`) is **not** excluded. A
  slot holder that goes quiet, or whose CI finished long ago and never woke it, is still detected,
  still gets a bounded recovery nudge and still escalates once the cap is reached.
- No separate age bound is added for a queued worker. Its wait is bounded by the slot it is queued
  behind, and the slot holder is supervised independently (the VS-467 merge-checks alarm, and this
  same stall detector when the holder's worker goes quiet). A queue that never drains is therefore
  always traceable to a slot holder that is itself flagged; a second timeout on the waiters would
  duplicate that escalation and reintroduce the false positive this change removes.
- A persisted `worker_stall_state` row is cleared when the worker's ticket enters the merge-queue
  wait, so the workers/tickets reads stop rendering the queued worker with the `stalled` UI status.
- Regression tests cover both directions: a queued-but-not-admitted worker produces no nudge, no
  finding and no state row; a slot-holding worker that ends a turn with work left and no wake still
  gets a recovery wake.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `worker-supervision/stalled-worker-detection`: the stalled-worker predicate gains the
  merge-queue-wait exclusion; a queued worker never enters bounded recovery or escalation, while a
  slot-holding worker still does.

## Impact

- `packages/core/src/supervisor/index.ts` — `stalledWorkers()` gains the `NOT (t.status = 'merging'
  AND t.merge_started_at IS NULL)` exclusion; `stallRecoveryResetPass()` clears a state row for a
  worker whose ticket is in the queue wait.
- Tests: `packages/core/src/supervisor/supervisor.test.ts` (both directions plus the persisted-row
  clear).
- No schema, config or API change: `merge_started_at` and `worker_stall_state` already exist.
