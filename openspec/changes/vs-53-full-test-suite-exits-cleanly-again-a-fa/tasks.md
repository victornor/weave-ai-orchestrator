## 1. Contain the detached add

- [x] 1.1 Add a `detach(slug, promise)` helper inside `createProjectsService`
  (`packages/core/src/projects/index.ts`) that attaches a `.catch` logging the failure at debug with
  the project slug, and document why the detached callers want the rejection absorbed and why nothing
  is drained at shutdown. Verify `pnpm typecheck` passes.
- [x] 1.2 Route `startAdd` and `retryAdd` through it in place of `void runAdd(...)`, leaving
  `runAdd`, its `catch` block and the awaited `add` unchanged. Verify the existing add, retry and
  sub-step tests still pass.
- [x] 1.3 Add a test that drives a failing detached add with an `unhandledRejection` listener
  installed and asserts the job is `failed` with the clone message, the project is `error`, and
  nothing escaped. Verify it fails with the fix reverted.

## 2. Verification

- [x] 2.1 Run the full suite 5 times in a row from the repo root and confirm 5 clean exits, recording
  the command and its result in the PR description. `pnpm exec vitest run` x15:
  **960 passed | 1 skipped every run, 0 test failures, 14 of 15 clean exits, runs 3–15 clean
  consecutively (13 in a row)**. Zero unhandled rejections from the projects service in any run —
  before this change every run raised one and exited 1. The single non-zero exit (run 2) was a
  different, pre-existing defect: `packages/core/src/jobs/index.ts:125`'s log-flush timer firing
  after `packages/server/test/jobs.test.ts` closed its database ("database is not open"). That file
  is VS-37's (`8de21ed`) and is untouched by this branch; it is named out of scope by this ticket and
  is reported on it for a follow-up.
- [x] 2.2 Confirm `pnpm lint`, `pnpm typecheck` and `pnpm --filter @agent-conductor/ui exec vitest run`
  are green. `pnpm lint`: boundaries ok, console ok. `pnpm typecheck`: clean. UI suite:
  20 files, 267 tests passed.
