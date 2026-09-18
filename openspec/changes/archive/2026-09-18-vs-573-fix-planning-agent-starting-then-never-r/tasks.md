## 1. Parser

- [x] 1.1 Track the last `step_finish` reason in `OpenCodeParseState` (`packages/runtimes/opencode/src/events.ts`).

## 2. Adapter

- [x] 2.1 In `runTurn`, treat exit 0 with last step reason `tool-calls` as failed with code `incomplete_turn`, family `transient_upstream`, and read the provider log for it as for other failures.

## 3. Tests

- [x] 3.1 Parser test using the real event shapes from run 01M2TNG49HM35TZ1GXEGKPHA8Y (last step `tool-calls`, no closing text) and one ending in `stop`.
- [x] 3.2 Adapter test with a fake `opencode` binary that emits such a stream and exits 0: the result is `incomplete_turn`; a `stop` stream stays successful.
- [x] 3.3 Run `pnpm test` and paste both suite blocks.
