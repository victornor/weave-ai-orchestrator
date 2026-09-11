## 1. Establish whether the waits expire late or never

- [x] 1.1 Instrument `until()` and the live-input 50-tick poll so a timeout records elapsed ms, poll count, last observed value, and whether the predicate becomes true if we keep waiting. Run the full suite under normal parallelism enough times to catch the flake. Verify: a timeout message says LATE or NEVER with a state snapshot, not only "condition was never reached".

## 2. Fix the waits at the cause

- [x] 2.1 Third consecutive auth-failure and the other `until()` waits after `runOnce()`/`drain()`. If the run never started, fail immediately with why `tick()` skipped. If it started, assert from `drain()` / `run.finished` instead of a 2s `setImmediate` poll. Verify: those tests pass without `until(..., 2000)`.
- [x] 2.2 Live-input handle test: wait for the handle-assignment signal (or `executeRun` finishing without one), not 50 `setImmediate`s. Verify: the test reads `send` from the active run after that signal, then still checks it is cleared at finalize.
- [x] 2.3 "resumes the same ticket on its own once the runtime recovers" — same family as 2.1 if it can return the previous failed run when `tick()` starts nothing. Verify: a no-op tick fails loudly instead of asserting on the stale run.

## 3. Same-shape waits and proof

- [x] 3.1 Name every other bounded `setImmediate`/N-tick poll for engine-driven state in the suite. Fix the same family or clear it as a different shape (EventBus microtask, background timer pipeline).
- [x] 3.2 Repeated full-suite runs under normal parallelism, plus lint and typecheck. Verify: post both suite blocks verbatim with real totals.
