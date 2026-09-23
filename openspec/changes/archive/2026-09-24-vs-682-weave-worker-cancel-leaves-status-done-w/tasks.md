## 1. Fix the watchdog's terminal-state check

- [x] 1.1 In `stalledWorkers()` (`packages/core/src/supervisor/index.ts`), widen the agent-status
      exclusion from `a.status != 'retired'` to also exclude `'done'`, and verify with
      `pnpm typecheck` that the query still compiles cleanly.

## 2. Regression tests

- [x] 2.1 Add a test: a worker at `status: 'done'` from a normal completion path (unlanded work,
      per VS-333) whose ticket is still open and past the stall threshold is not returned by
      `stalledWorkers()` and produces no `worker.stalled` event, no automatic recovery wake, and no
      `gate_finding` when the stall/recovery sweep runs — verify by running the new test file.
- [x] 2.2 Add a test: a worker cancelled via `weave_worker_cancel` (`status: 'done'`, ticket left
      open) past the stall threshold is not returned by `stalledWorkers()` and produces none of the
      same — verify by running the new test file.
- [x] 2.3 Run the full core/server suite (`pnpm vitest run packages/core`) and confirm the existing
      `worker-supervision/stalled-worker-detection` scenario tests (terminal-ticket, retired-agent,
      merge-queue-wait, etc.) still pass unchanged.

## 3. Validate and deliver

- [x] 3.1 `openspec validate vs-682-weave-worker-cancel-leaves-status-done-w --json --strict`
      passes clean.
- [x] 3.2 `pnpm lint && pnpm typecheck && pnpm test` all green; commit with the ticket id and open
      the PR per delivery.md, stating plainly in the PR which side was wrong (the watchdog's check,
      not `weave_worker_cancel`) and why.
