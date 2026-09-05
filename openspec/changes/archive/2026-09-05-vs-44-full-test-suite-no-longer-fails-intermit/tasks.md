## 1. Contain and track the ticket service's detached work

- [x] 1.1 Add the `schedule(delayMs, label, fn)` helper inside `createTicketsService`
  (`packages/core/src/tickets/service.ts`): keep the timer id, `.unref()` it as today, and on fire
  drop the id, run `fn` inside `try`/`catch`, log a caught throw at debug with the label, and hold the
  resulting promise until it settles. Verify with a unit test that a `fn` throwing synchronously is
  logged and raises nothing.
- [x] 1.2 Route the post-merge spec re-index (`service.ts:720`) through `schedule`, keeping the 100 ms
  delay, the `t.projectId` guard and the `deps().specs.index(pid)` call unchanged. Verify with a test
  that a merge with a `specs` stub re-indexes the project, and a merge on a ticket without a project
  schedules nothing.
- [x] 1.3 Route the post-`in_review` auto-merge sweep (`service.ts:317`) through `schedule`, keeping
  its 50 ms delay and its `autoMerge` guard. Verify the existing auto-merge tests still pass.
- [x] 1.4 Add `stop(): Promise<void>` to the service: cancel every pending timer, `Promise.allSettled`
  the in-flight promises, resolve without rejecting. Verify with tests that a scheduled-but-unfired
  task never runs after `stop()`, that `stop()` resolves only once in-flight work has settled, and
  that `stop()` is safe when idle and when called twice.
- [x] 1.5 Declare `stop()` on the `TicketsService` interface in `packages/core/src/api.ts` with a
  comment saying what it drains. Verify `pnpm typecheck` passes.

## 2. Drain on shutdown

- [x] 2.1 Call `ws.services.tickets.stop()` in the per-workspace loop of `shutdown()`
  (`packages/server/src/daemon.ts`), before the `db.close()` loop, logging a failure with `log.warn`
  like the neighbouring stops. Verify with a server test that a merge scheduled immediately before
  shutdown leaves no work running past the database close, and that shutdown reports no error.

## 3. Make the ticket suites deterministic

- [x] 3.1 Give the test harness a `specs` stub (`packages/core/src/testing/context.ts`), matching the
  one `merge-queue.test.ts:28` already builds by hand, and use it in `tickets.test.ts`. Verify
  `tickets.test.ts` merges without touching the throwing proxy.
- [x] 3.2 Change `afterEach` in `packages/core/src/tickets/tickets.test.ts` and
  `packages/core/src/tickets/merge-queue.test.ts` to `await tickets.stop()` before `h.cleanup()`.
  Verify both suites pass.
- [x] 3.3 Sweep the fakes that implement `TicketsService` — `packages/core/src/testing/context.ts` and
  `packages/server/test/fakes.ts` — so no suite reaching `tickets.stop()` hits the "core service was
  not provided" proxy throw. Verify the full `pnpm test` passes.

## 4. Verification

- [x] 4.1 Run the core suite 10 times in a row and confirm 10 clean passes with no timer-related
  failure, and record the command and its result in the PR description. `pnpm vitest run` x10:
  **934 passed | 1 skipped every run, 0 test failures, 0 timer-related errors**. Each run also
  reports one unhandled rejection from `packages/core/src/projects/index.ts` (`void runAdd(...)`,
  introduced by VS-37, reproduced on plain `main` with this branch not involved), which holds the
  exit code at 1. The human ruled that out of VS-44's scope on 2026-09-05 (decision
  `vs-44-projects-unhandled-rejection`, answered `split_out`) to be fixed under its own ticket, so
  the "no unhandled error" half of this task is deliberately not met here.
- [x] 4.2 Confirm no production behaviour changed: `pnpm typecheck` and `pnpm lint` green, `pnpm test`
  green on tests (934 passed, 0 failures; see 4.1 for the out-of-scope non-zero exit), and the
  re-index and the auto-merge sweep still fire at their original delays after a merge and after
  `in_review` — the 100 ms and 50 ms delays and both guards are unchanged, covered by the new
  `post-merge follow-up work` tests and the existing auto-merge tests.
