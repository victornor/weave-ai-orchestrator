## Context

Run `01M2TNG49HM35TZ1GXEGKPHA8Y` (planner, opencode `xai/grok-4.6`, 2026-09-18 16:27:22–16:28:43 UTC) processed captain's Plan-tab message, made 19 tool calls, and ended with `turn.completed failed:false`, status `succeeded`, liveness `empty`. The last `usage.delta` carried `reason: "tool-calls"` (the parser's copy of the last `step_finish` reason), so the model was mid-work when the stream stopped and the process exited 0. No reply was posted and the wake was marked `completed`.

Which provider-side failure ended the stream is not recoverable from the DB; opencode's log is a runtime directory this ticket must not read. VS-461 already records that opencode swallows provider stream errors and gives no stdout signal.

## Decisions

- **Detect from the stream, not the cause.** A `step_finish` reason of `tool-calls` means the model asked for another step. If the process exits with no error after that, the turn was cut off. This holds whatever the underlying provider error was.
- **Reuse the existing retry path.** Report it as `transient_upstream` (code `incomplete_turn`). `RETRYABLE` in `packages/core/src/runs/engine.ts:50` already retries that family with backoff and parks the run for the human when the budget is spent. Considered and rejected: a new error family (needs engine changes for no behavioural difference) and a Plan-thread-specific "no reply" watchdog (covers only planners, and only after a timeout).
- **Terminal reasons stay successful.** Only `tool-calls` is treated as non-terminal. Any other reason, and a stream with no `step_finish`, keeps today's outcome, so existing behavior for `stop`, `length` and error streams does not change.

## Risks

- A model that legitimately ends its turn on a tool call with nothing after would be retried up to three times. opencode's loop always issues a following step after tool results, so that is not a normal ending.
- The retry re-runs the same session; the message is redelivered through the retry wake. Task 3.2 checks the adapter result only; retry delivery is the engine's existing behavior.
