## 1. Exclude the merge-queue wait from the stall predicate

- [x] 1.1 Add `AND NOT (t.status = 'merging' AND t.merge_started_at IS NULL)` to `stalledWorkers()`
      in `packages/core/src/supervisor/index.ts`, matching the predicate `spawnPending()` already
      uses, and update its doc comment to name the merge-queue wait as an explicit exclusion.
- [x] 1.2 Verify with a test that a queued-but-not-admitted worker (`status = 'merging'`,
      `merge_started_at` null, `merge_queued_at` set) with a stale `last_run_at`, no queued wakeup
      and no running run is not selected: no `worker.stalled` event, no recovery wake, no
      `worker_stall_state` row, no `gate_finding`.
- [x] 1.3 Verify with a test that a slot-holding worker (`status = 'merging'`, `merge_started_at`
      set) in the same otherwise-stalled shape is still detected and receives a bounded automatic
      recovery wake.

## 2. Clear the persisted stall fact on entering the queue wait

- [x] 2.1 In `stallRecoveryResetPass()` (or the equivalent reset step), delete a worker's
      `worker_stall_state` row when its ticket is `merging` with `merge_started_at` null, and emit
      the cleared status event as the existing reset paths do.
- [x] 2.2 Verify with a test that a worker holding a `worker_stall_state` row whose ticket then
      becomes `merging` with `merge_started_at` null has the row deleted and `isWorkerStalled()`
      reads false.

## 3. Verification

- [x] 3.1 Run the full test suite (`pnpm test`, both the core/server and UI blocks), `pnpm lint` and
      `pnpm typecheck`; fix anything that regresses, and paste both suite blocks in the delivery.
