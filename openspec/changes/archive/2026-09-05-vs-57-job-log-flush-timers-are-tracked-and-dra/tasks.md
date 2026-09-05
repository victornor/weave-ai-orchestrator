## 1. Track and drain the flush timer

- [x] 1.1 In `packages/core/src/jobs/index.ts`, move the timer clear into `flush` ahead of the dirty
  check, `unref` the timer `line()` arms, and wrap the row write so a failure logs at warn with the
  job id instead of throwing out of the timer. Document why a flush must not throw.
- [x] 1.2 Add `stop(): Promise<void>` to the service: mark it stopped, flush every live job, and arm
  no new timer afterwards. Declare it on `JobsService` in `packages/core/src/api.ts` with the same
  "drain before disposing of the workspace database" note the ticket service's `stop` carries.

## 2. Drain it where the database closes

- [x] 2.1 `packages/server/src/daemon.ts`: drain the jobs service in `shutdown`, immediately after
  the ticket service's drain and before the workspace databases close, and in `unregister` before it
  closes one.
- [x] 2.2 Make the server test harness's `close()` async and have it drain the real jobs service
  before closing the db (`packages/server/test/fakes.ts`), and await it in the eight teardowns that
  call it. Drain in `packages/core/src/projects/projects.test.ts`'s `afterEach` too — it runs a real
  jobs service against a real database.

## 3. Prove it

- [x] 3.1 Tests in `packages/core/src/jobs/jobs.test.ts`: the tail is on the row after the flush
  delay and not before; `stop()` writes a tail that has not been flushed yet; nothing fires after a
  drain followed by a close; a flush against a closed database warns exactly once instead of
  throwing. Verify they fail with the fix reverted.
- [x] 3.2 Run the full suite 10 times in a row and confirm no jobs-related error in any run, and that
  `pnpm lint`, `pnpm typecheck` and the web app's suite are green. Record the results in the PR.
  `pnpm exec vitest run` x10 after rebasing onto `main` at `110a4b2`: **982 passed | 1 skipped and
  exit 0, all ten runs**, with **zero** occurrences of `packages/core/src/jobs/index.ts` in any error
  and zero unhandled errors or rejections of any kind. `pnpm lint`: boundaries ok, console ok.
  `pnpm typecheck`: clean. Web app suite: 28 files, 358 tests passed.

  (Recorded before the rebase, off `91514ff`: the same ten runs were 977 passed | 1 skipped with zero
  jobs-related errors, but exited 1 on the projects-service unhandled rejection that VS-53 / #44 had
  not yet landed. #44 merged while this ticket waited in the queue, so the criterion is met literally
  now rather than conditionally.)
