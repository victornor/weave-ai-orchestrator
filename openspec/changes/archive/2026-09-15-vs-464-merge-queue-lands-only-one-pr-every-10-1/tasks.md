# Tasks

- [x] 1. Measure the last ten landings: queue wait, wake latency (admission → run start), merge turn, CI duration, and any retries or cancelled runs, from `tickets`, `events`, `runs` and the GitHub Actions API. Record the table in the ticket's `report` document and the PR.
- [x] 2. Rank an agent holding a queued `merge_approved` wake above ordinary workers in `packages/core/src/runs/dispatcher.ts`, so an admitted merge takes the next free run slot instead of waiting out its `last_run_at` fairness turn.
- [x] 3. Check whether the merge turn's full local suite can be dropped before narrowing it: it cannot, because CI does not gate landings (PRs #380 and #379 merged with every check `skipped` on the merged head, and the gate took `skipped` as passing). Keep the merge turn's full local lint, typecheck and both suites; defer the cut to [VS-466](weave://tickets/VS-466).
- [x] 4. Tests: the dispatcher admits a merge-slot holder ahead of a worker that ran more recently, and the ordinary fairness order is otherwise unchanged.
- [x] 5. Run lint, typecheck and both suites green; open the PR with the measured before/after table.
