# Land the merge queue faster: measure the landing, cut the redundant work

Tracker change for [VS-464](weave://tickets/VS-464). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Ten landings between 22:50 and 00:47 — one every ~12 minutes — while CI takes ~3.8 minutes. The
serial merge step (admission to `ticket.merged`) averages **14.0 minutes**, not because CI is slow
but because the merge turn waits for a run slot behind ordinary development turns.

## What changes

- **Measure.** The last ten landings split into queue wait, wake latency (admission → run start),
  merge turn, and CI, with the retries and cancelled runs named. Recorded on the ticket as its
  `report` document and in the delivery.
- **Merge-slot dispatch priority.** `packages/core/src/runs/dispatcher.ts`: an agent holding a
  queued `merge_approved` wake is ranked above ordinary workers, so an admitted merge takes the next
  free run slot rather than waiting for its `last_run_at` fairness turn. Addresses the ~4.3 min
  average wake latency, which is the 6-run cap (VS-439 was admitted with six runs active and started
  12.2 min later).

## Deferred to VS-466

The second candidate — stop re-running the full local suite on the merge turn and let CI be the
full suite — was **not** taken. Verifying it found that CI does not gate landings today: PRs #380
and #379 merged with every check `skipped` on the merged head, because the only run for that SHA was
the draft-skipped `pull_request` run and the gate treated `skipped` as passing. The worker's local
full suite is therefore the only test that actually ran, and it is kept. The cut returns once
[VS-466](weave://tickets/VS-466) (critical) makes the gate require a successful run on the exact head
SHA. The duplicate CI push is also VS-466's scope.

## Safety

Nothing lands without green CI on the rebased head: the merge step still marks the pull request
ready and the daemon still gates on its checks. A real conflict still goes back to the worker. The
merge turn keeps its full local lint, typecheck and both suites.

## Out of scope

- Priority ordering (VS-390).
- Batching several PRs into one landing.
- The self-hosted runner (VS-394).
- The daemon performing the mechanical rebase/push/land itself.
- The duplicate-run cut, the cancelled duplicate CI push, and the skipped-gate audit — VS-466.
