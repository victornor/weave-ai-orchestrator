## 1. Classifier

- [x] 1.1 Add `isTransientGitFetchError(stderr: string): boolean` to `packages/core/src/util/git.ts`,
      matching connect-timeout/connection-reset/DNS-failure transport signals and explicitly not
      matching a bare "Could not read from remote repository" or "Permission denied". Verify with a
      unit test in `packages/core/src/util/git.test.ts` asserting the ticket's exact connect-timeout
      text (`ssh: connect to host github.com port 22: Connection timed out` /
      `fatal: Could not read from remote repository.`) is transient and
      `Permission denied (publickey)` (paired with the same "Could not read from remote repository"
      line) is not.

## 2. Retry helper

- [x] 2.1 Add `fetchOriginWithRetry(cwd, timeoutMs, opts)` to `packages/core/src/util/git.ts`: runs a
      fetch (`opts.run`, defaulting to the real `git(['fetch','origin'], cwd, timeoutMs)`), and on a
      transient failure retries with backoff (`opts.delaysMs`, default `[30_000, 90_000]`) up to
      `opts.attempts` (default `delaysMs.length + 1`) total attempts, sleeping via `opts.sleep`
      (default real `setTimeout`) between them and reporting each attempt via `opts.onAttempt`.
      A non-transient failure returns immediately with no retry. Verify with unit tests in
      `packages/core/src/util/git.test.ts` using an injected `run` and a no-op `sleep`: retry-then-
      succeed (fails transiently once, succeeds on attempt 2, no real delay, `attempts: 2` returned),
      retry-then-exhausted (fails transiently on all 3 attempts, returns the last failing result,
      `onAttempt` called 3 times, no real delay), and a non-transient failure returning immediately
      after exactly one call to `run` with no call to `sleep`.

## 3. Wire into the primary-clone fetch

- [x] 3.1 Change `fetchLanding` in `packages/core/src/projects/index.ts` to call
      `fetchOriginWithRetry` instead of a single `git(['fetch','origin'], …)`, passing an `onAttempt`
      that logs each attempt (`log.warn`, with the project slug, attempt number, and truncated
      stderr) and threading an optional `Logger` parameter through from its two callers, `fetch()` and
      `checkSync()` (both already hold `log` in the service closure). On a final failure, throw the
      existing `OcError('internal', …)` with the message stating the attempt count when more than one
      was made (e.g. "git fetch failed after 3 attempts: …"). Verify: `pnpm typecheck` passes, and the
      existing `projects.test.ts` `checkSync` tests and `engine.test.ts` "curation checkout freshness
      gate" tests (including "blocks the ticket and never runs the turn when fetching origin fails",
      a non-transient local-path failure) still pass unmodified — a non-transient failure must still
      park on the first attempt with no added delay.

## 4. Verification

- [x] 4.1 Run `pnpm vitest run packages/core/src/util packages/core/src/projects packages/core/src/runs/engine.test.ts` and confirm everything is green.
- [x] 4.2 Run `pnpm lint && pnpm typecheck` and confirm both are clean.

## 5. Make the retry opt-in (review revision)

- [x] 5.1 Change `fetchLanding`'s signature to `fetchLanding(project, log?, opts: { retryTransient?: boolean } = {})`, forcing `attempts: 1` on `fetchOriginWithRetry` unless `opts.retryTransient` is set. Change `ProjectsService.fetch` to `fetch(id, opts: { retryTransient?: boolean } = {})`, threading `opts` into `fetchLanding`; leave `checkSync` calling `fetchLanding(project, log)` with no opts, so it keeps a single attempt. Update the `fetch` signature in `packages/core/src/api.ts` to match. Change the curation freshness gate in `packages/core/src/runs/engine.ts` (~line 430) to call `deps().projects.fetch(project.id, { retryTransient: true })`; every other caller of `projects.fetch` (`repoDelivery.ts`, `repoSwitch.ts`, `openspec/index.ts`, `supervisor/index.ts` ×2, `routes/projects.ts`'s `POST /:id/fetch`) is left unchanged and so stays on the single-attempt default.
- [x] 5.2 Add a test proving the default is single-attempt and the opt-in retries: `packages/core/src/projects/fetchRetryOptIn.test.ts`, mocking only `fetchOriginWithRetry`'s `run`/`sleep` (never a real network call, never a real delay) to force a transient failure on every call. Verify `checkSync` and a bare `fetch(id)` each make exactly one fetch attempt and throw; `fetch(id, { retryTransient: true })` makes exactly three attempts and throws with "after 3 attempts" in the message.
- [x] 5.3 Re-run `pnpm vitest run packages/core/src/util/git.test.ts packages/core/src/projects packages/core/src/runs/engine.test.ts`, `pnpm lint`, and `pnpm typecheck`; confirm all green.
