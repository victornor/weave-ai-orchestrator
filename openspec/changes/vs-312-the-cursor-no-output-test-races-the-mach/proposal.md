## Why

`packages/runtimes/cursor/test/liveInput.test.ts`'s "fails fast on a silent process (VS-187)" block
passes `noOutputGraceMs: 100` and then asserts against real elapsed time. Under a full `pnpm test`
run — dozens of vitest workers on one machine — spawning a process can itself exceed 100ms, so the
case that expects a process producing output *not* to trip the check fails for a process that was
merely slow to start. Every full core-suite run then reports `1 failed | 2673 passed`, which makes a
real break indistinguishable from this known race. The production behaviour under test is correct
and stays exactly as it is; this is a test-only determinism fix.

## What Changes

- `packages/runtimes/cursor/test/liveInput.test.ts`: drive the adapter's no-output grace with vitest
  fake timers (`vi.useFakeTimers()` + `advanceTimersByTimeAsync`) instead of real elapsed time. The
  deadline is reached by advancing the frozen clock, never by waiting, so the test asserts the
  mechanism rather than the machine.
- `packages/runtimes/cursor/test/fakeCli.ts`: add `holdOpen` to the existing fake `cursor-agent` so a
  test can observe the adapter against a process that has produced output but is still alive, then
  end it with SIGINT. The default (exit immediately) is unchanged for every other caller.
- No production code changes. `NO_OUTPUT_GRACE_MS` stays 20s; no assertion is weakened, skipped or
  marked flaky.
- No real start-up race was found: `sawOutput` is set synchronously in the adapter's `onLine` before
  the grace timer is consulted, so there is no window in which already-arrived output is lost to the
  expiry. The failure is a slow spawn, not an adapter bug.

## Capabilities

### New Capabilities

(none — test-file-only determinism fix; no product-facing capability)

### Modified Capabilities

(none — no spec-level behaviour changes; the fix touches only test timing and a test fixture)

## Impact

- `packages/runtimes/cursor/test/liveInput.test.ts` and `packages/runtimes/cursor/test/fakeCli.ts`
  only. No change to `packages/runtimes/cursor/src/adapter.ts`, the runtime SDK, or any other runtime.
- No API, schema, or behaviour change.
