## Why

The automatic compaction policy currently re-fires from the same recorded context size on every dispatcher tick. Live journal evidence shows two real successes followed by 43 second-order failures, all measuring the unchanged 813,725-token observation; the repeated attempts hold the queued wake and livelock the agent.

## What Changes

- Add per-observed-context-size memory to automatic compaction so one context measurement can trigger at most one attempt.
- Make every automatic compaction attempt a terminal result for that measurement: persist failures, clear the busy mark, and allow the held wake to dispatch rather than retrying on the timer.
- Preserve manual “Compact now” behavior while using the same session state and result handling.
- Keep the Claude adapter’s strict compaction-boundary detection unchanged; the journal confirms the predicate observed real boundaries for both successful attempts. Treat a later no-boundary result as a legitimate failed attempt.
- Add regression coverage for repeated dispatcher ticks, successful and failed attempts, and the existing Claude boundary/no-boundary behavior.

## Capabilities

### New Capabilities

- `runtime-session-compaction`: Defines safe, observable out-of-band session compaction and automatic-policy retry suppression.

### Modified Capabilities

- None.

## Impact

- `packages/core/src/runs/dispatcher.ts` automatic compaction eligibility and wake handling.
- `packages/core/src/workers/index.ts` asynchronous compaction result persistence and events.
- `packages/core/src/sessions/index.ts` session compaction/context bookkeeping if needed by the policy state.
- `packages/runtimes/claude/src/adapter.ts` fixtures/tests to pin the unchanged boundary behavior.
- Core and Claude runtime regression tests; no public API or schema migration is expected unless implementation inspection proves one necessary.

The live diagnosis to carry into the ticket/PR is: 45 attempts all logged `tokens: 813725, threshold: 500000`; successes occurred at 16:41:07Z and 16:42:40Z, and the 43 failures followed those successes. The two successful boundary observations confirm the adapter check is correct.
