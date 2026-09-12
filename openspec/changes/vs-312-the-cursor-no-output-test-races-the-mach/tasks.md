## 1. Make the test deterministic

- [x] 1.1 Add a `holdOpen` option to `writeFakeCursorCli` that answers normally then stays alive until SIGINT (exiting 0), leaving every existing caller on the default immediate-exit path; verify the other tests in `liveInput.test.ts` still pass
- [x] 1.2 Rewrite the two "fails fast on a silent process (VS-187)" cases to drive the grace with `vi.useFakeTimers()` / `advanceTimersByTimeAsync`, keeping the original `no_output`, `exitCode === 0` and `error === undefined` assertions; verify the file passes in isolation

## 2. Prove the tests assert the mechanism

- [x] 2.1 Mutation-check: forcing the adapter's `if (!sawOutput)` to always cancel must make only the output case fail, and reverting must restore green; verify the adapter diff is empty afterwards
- [x] 2.2 Confirm no production race exists (output is recorded before the grace timer consults `sawOutput`) and record that finding in the ticket

## 3. Verify and deliver

- [x] 3.1 `pnpm lint` and `pnpm typecheck` green
- [x] 3.2 Full `pnpm test` run: both suite blocks green, totals pasted verbatim on the ticket
- [x] 3.3 Confirm `NO_OUTPUT_GRACE_MS` is unchanged at 20_000 and no production file is modified; open the PR and transition to `in_review`
