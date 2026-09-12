## Context

See proposal.md — Why. The adapter's no-output check is a `setTimeout` registered in `runTurn`
(`packages/runtimes/cursor/src/adapter.ts:128`) whose callback cancels the turn when `sawOutput` is
still `false`. `sawOutput` is set synchronously inside the `spawnLines` `onLine` callback
(`adapter.ts:110`). The two tests spawned a real fake CLI and raced that timer against real spawn
latency.

## Goals / Non-Goals

**Goals:**
- Both cases pass deterministically under a full `pnpm test`, not just in isolation.
- The tests assert the adapter's no-output decision, including that the timer does not cancel a turn
  that has already produced output.
- No production timing or behaviour changes.

**Non-Goals:**
- Changing `NO_OUTPUT_GRACE_MS` or any other production constant.
- Injecting a clock into the `RuntimeAdapter` interface (a wider production surface than this
  test-only fix warrants).

## Decisions

- **Drive the grace with fake timers.** `vi.useFakeTimers()` freezes `setTimeout`, and the test
  advances the clock by exactly the grace via `vi.advanceTimersByTimeAsync`. The deadline can no
  longer be reached by a slow spawn, so the 100ms override is only a number the test controls, not a
  cliff a loaded machine can push into.
  - *Alternative considered:* inject a timer/clock into the adapter. Rejected — it widens the runtime
    SDK surface to fix a test, and fake timers already reach the adapter's real `setTimeout`.
  - *Alternative considered:* raise `noOutputGraceMs`. Rejected as the ticket says — it moves the
    cliff rather than removing it; the next loaded machine finds it again.
- **Hold the fake CLI open to observe the non-expiry path.** The original second case relied on the
  process finishing before the grace; with the clock frozen it would only prove "frozen time does not
  advance". The new `holdOpen` variant answers, then stays alive until SIGINT, so the test can let the
  deadline elapse *while the process is still running* and assert no `no_output`. `writeFakeCursorCli`
  installs no SIGINT handler by default; the `holdOpen` variant exits 0 on SIGINT so the test can end
  it cleanly and still assert `exitCode === 0`.
- **`vi.useRealTimers()` restored in `afterEach`** so a failing test cannot leak fake timers into the
  rest of the file.

## Risks / Trade-offs

- [Fake timers and real child-process I/O could interleave differently than expected] → Both cases
  were mutation-tested: forcing the adapter's `if (!sawOutput)` to always cancel makes the second case
  fail with `no_output`; the silent case fails if the timer does not fire. The tests are therefore
  sensitive to the mechanism, not merely green.
- [`holdOpen` changes a shared fixture] → It defaults to `false`, so the existing callers that expect
  a prompt exit are untouched.
