## 1. Widen the decisions kind constraint

- [x] 1.1 Add `packages/db/src/migrations/0010_decision_kinds.sql` rebuilding `decisions` per
  design.md — create the widened table, copy every row, drop the old table, rename, recreate
  `decisions_open_corr` and `decisions_ws_status` — with a header comment saying why a rebuild is
  needed and that it must stay a leaf-table rebuild. Verify by opening a fresh database and asserting
  `PRAGMA table_info(decisions)` returns the same columns in the same order as before the change.

- [x] 1.2 In `packages/db/src/migrations.test.ts`, prove the rebuild on a database seeded through the
  earlier schema with an open decision carrying a correlation key and a target, an answered decision,
  and a decision with no ticket: after migrating, all three are present with their kind, status,
  answer, correlation key, target and ticket link unchanged, both indexes and both foreign keys are
  back, `PRAGMA foreign_key_check` returns no rows, and a second `openDb` on the same file is a no-op
  that leaves the `migration:0010_decision_kinds.sql` row alone.

- [x] 1.3 Add the drift test in `packages/db/src/migrations.test.ts`: read the `decisions` DDL from
  `sqlite_master`, extract the literals of the `kind IN (…)` clause, and assert set equality with
  `DECISION_KINDS` from `@agent-conductor/shared` in both directions. Verify it fails when a kind is
  added to the enum alone (check by temporarily asserting against `DECISION_KINDS` plus an extra
  value, then reverting).

- [x] 1.4 Add a test that inserting each kind in `DECISION_KINDS` into `decisions` succeeds and that a
  kind outside it is still refused by the CHECK.

## 2. Make parking loud and step-independent

- [x] 2.1 In `parkForHuman` (`packages/core/src/runs/engine.ts`), give each step — pausing the agent,
  raising the decision, transitioning the ticket to `blocked`, booking the quota retry — its own
  guard that logs at `error` with the run id, the agent id, the step name and the reason, so a failure
  in one does not skip the rest. Do not change the order, the steps, the retry ladder or the
  conditions under which a worker is parked. Verify by review against design.md — Decisions and by
  the tests in 2.2 and 2.3.

- [x] 2.2 In `packages/core/src/runs/engine.test.ts`, prove the parked path end to end: a worker turn
  that fails non-retryably leaves the worker paused, its ticket `blocked`, and exactly one open
  `retry_approval` decision on that ticket carrying the retry, retry-later, alternative-runtime and
  cancel options and a recommendation — read back through the decisions service's open list, not
  straight from the table.

- [x] 2.3 Add a test that when raising the decision throws, the ticket is still moved to `blocked` and
  the failure is logged at `error` naming the run and the agent.

- [x] 2.4 Add a test that a worker with an open `retry_approval` decision that then completes a turn
  successfully has that decision withdrawn.

## 3. Verify and deliver

- [x] 3.1 Run `pnpm typecheck`, `pnpm lint` and the vitest suites for `@agent-conductor/db`,
  `@agent-conductor/core` and `@agent-conductor/ui`, and confirm all are green (the `ui` suite is run
  separately; see the project knowledge base on the chained root `pnpm test`).

- [x] 3.2 Open the PR, stating that the migration applies on the daemon's normal startup migrate so a
  normal `conductor daemon upgrade` is sufficient, that existing decisions are preserved, and that
  rolling back to a release without the migration is safe against the widened table.
