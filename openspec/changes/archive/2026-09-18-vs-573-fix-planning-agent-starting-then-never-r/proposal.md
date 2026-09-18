## Why

Captain messaged the planner in an existing Plan tab at 2026-09-18 16:27 UTC. VS-567's rebind worked: the wake was delivered and run `01M2TNG49HM35TZ1GXEGKPHA8Y` started (opencode, `xai/grok-4.6`). The run then went silent and no reply was ever posted.

The run's `events.jsonl` shows what happened. The model ran 19 tool calls across five steps. Its last `step_finish` had `reason: "tool-calls"`: the model had asked for more work, and the tool results were in. The process then exited 0. The stream has no closing text and no fifth-step follow-up. `OpenCodeParser.finish()` (`packages/runtimes/opencode/src/events.ts:155-160`) emits `turn.completed` unconditionally, and `runTurn` (`packages/runtimes/opencode/src/adapter.ts:239`) marks the turn failed only for a non-zero exit, a timeout or an `error` event. So the run was recorded `succeeded`, `liveness: empty`, the wake was `completed`, and nothing retried it. To the human it looked like the planner started and never answered.

The exact cause of opencode's early exit is not in the DB: opencode's own log is outside what this ticket may read (runtime directories are daemon-only). VS-461 already established that opencode swallows provider stream errors and exits without a stdout signal, and a stream that ends after a `tool-calls` step is that shape. The fix does not depend on knowing which provider error it was.

## What Changes

- The opencode stream parser records the reason of the last `step_finish`.
- `runTurn` treats a turn whose stream ended on a non-terminal reason (`tool-calls`, i.e. the model still owed a reply) as a failed turn with error code `incomplete_turn`, family `transient_upstream`. The run engine already retries that family with backoff (30 s / 2 min / 10 min), resuming the same session, so the planner picks the message up again instead of going silent. If a provider error was logged for the session, its message is attached as for other failures (VS-461).
- Retry exhaustion parks the run for the human as it does for any transient failure, so it is never a silent success.

## Capabilities

### New Capabilities
- `opencode-turn-completion`: when an opencode turn counts as finished versus interrupted.

### Modified Capabilities
None.

## Impact

- `packages/runtimes/opencode/src/events.ts` (parser state) and `adapter.ts` (`runTurn`).
- Tests in `packages/runtimes/opencode/test` (a recorded-shape fixture of the 2026-09-18 stream).
- No change to the run engine, Plan-thread code or the UI.
