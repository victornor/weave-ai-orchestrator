## Why

VS-214 replaced a guessed `setImmediate` after `runOnce()` with `until()` (2s of
`setImmediate` polls). The helper still times out under full-suite load, so
`pnpm test` goes red on `engine.test.ts` and the gate is untrustworthy. The
question is whether the awaited state arrives late or never arrives — that
decides whether the wait is wrong or the engine is.

## What Changes

- Instrument the three named waits so a timeout reports the observed state and
  whether the predicate later becomes true.
- Fix the waits at the cause: prefer a signal the engine or fake runtime already
  emits (`run.finished`, handle assignment) over a bounded `setImmediate` poll.
  Do not raise a deadline as the fix.
- Name every other same-shape bounded poll in the suite and either fix it or
  clear it.
- Tests and test harness only. No engine behaviour change. A real engine defect
  is reported, not patched here.

## Capabilities

### New Capabilities

(none — test harness only)

### Modified Capabilities

(none)

## Impact

- `packages/core/src/runs/engine.test.ts` and possibly `packages/runtime-sdk`
  testkit if the live-input wait needs a handle-ready signal.
- No product behaviour. No `skip` / retry / loosened assertion.
