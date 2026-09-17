## 1. Preserve the initiating run during terminal cleanup

- [x] 1.1 Update terminal worker release to compare each active run with the transition actor's `runId`, skipping cancellation and immediate retirement only for the run that performed the terminal transition; verify unrelated active runs still receive the existing interrupt path.
- [x] 1.2 Update run finalization to preserve a worker's terminal `done` state after a successful self-closing run, while retaining existing status/error/liveness handling for genuine failures; verify the worker remains out of live statuses after finalization.

## 2. Regression coverage

- [x] 2.1 Add a run-engine regression that transitions the worker's own ticket to `done` during the active fake-runtime turn, returns a valid structured report, and verifies the ticket is terminal, the run is succeeded with stored liveness/summary/report, and the worker is not interrupted or live.
- [x] 2.2 Add or extend ticket/run tests for an external terminal transition during an active run, verifying the unrelated run is still interrupted and queued wakes are cancelled.

## 3. Verification and delivery evidence

- [x] 3.1 Run the focused core tests for run finalization and terminal retirement, capturing the observed run status, error code, liveness, summary, and ticket/worker statuses from the self-closing regression.
- [x] 3.2 Run the repository's required full test suites, lint, and typecheck; report both core/server and UI suite blocks verbatim and include the focused regression evidence in the delivery notes.
