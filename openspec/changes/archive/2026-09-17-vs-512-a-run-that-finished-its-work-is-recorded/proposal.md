## Why

When a worker closes its own ticket, terminal-ticket cleanup sees the worker's active run and schedules an interrupt for it. That race can terminate the runtime before the run engine collects the final structured report, recording a completed turn as `interrupted` with `no_report`. The daemon needs to retire the worker without interrupting the run that is already completing the ticket, while preserving interruption for unrelated active runs.

## What Changes

- Make terminal-ticket cleanup distinguish the run that performed the terminal transition from other active runs bound to the ticket.
- Leave the current worker-owned run alive long enough for the runtime result and final report to be collected and persisted.
- Continue interrupting an active run when a different actor closes the ticket, and continue cancelling queued wakes and taking the worker out of the live set immediately.
- Add an end-to-end run-engine regression covering a worker-owned terminal transition, including the recorded run status, liveness, summary, and ticket outcome.
- Add a regression covering the external-terminal-transition path so cleanup does not lose its existing cancellation behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `worker-supervision/terminal-retirement`: terminal cleanup must not interrupt the active run that is performing the terminal transition, while still interrupting unrelated active runs.

## Impact

- `packages/core/src/tickets/service.ts` terminal worker release and its actor/run identity handling.
- `packages/core/src/runs/engine.test.ts` and/or ticket service tests for the real run-finalization sequence.
- No public API or database migration is expected; the change is limited to terminal cleanup ordering and regression coverage.
