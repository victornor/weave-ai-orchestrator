## Context

The run engine collects the runtime result and parses the structured final report only after the
runtime turn returns (`packages/core/src/runs/engine.ts`). Terminal ticket transitions currently call
`releaseWorkersForTerminal`; for each active worker it marks the worker done and schedules
`runs.cancel` immediately. The actor on an agent-originated transition carries the current run id,
so the cleanup can identify the self-cancellation race without relying on runtime-specific process
signals. The existing terminal-retirement behavior and supervisor retry path must remain intact for
work that another actor cancels.

## Goals / Non-Goals

**Goals:**

- Preserve the final runtime result and structured report when the run itself closes its ticket.
- Keep the worker out of live statuses and cancel queued future wakes as soon as the ticket becomes
  terminal.
- Interrupt unrelated active runs on externally caused terminal transitions.
- Ensure finalization does not reactivate a worker already made terminal by its own run.
- Capture the sequence in a deterministic regression test and record observed status/report fields.

**Non-Goals:**

- Changing the run status vocabulary or treating arbitrary `no_report` outcomes as successful.
- Changing ticket transition guards, delivery rules, retirement evidence, or database schema.
- Supporting a runtime-specific workaround for Claude, OpenCode, or any other adapter.

## Decisions

### Identify the initiating run by actor identity

Use the transition actor's `runId` as the ownership signal. When the active run id equals that value,
terminal cleanup will not call `runs.cancel` for it. This is more precise than skipping cancellation
for every worker-owned transition: an agent can transition a different ticket only through authorized
paths, and an external actor must retain the existing cancellation behavior.

### Defer retirement of the initiating worker until finalization

Terminal cleanup will still set the worker to `done`, mark its worktree dirty, and cancel queued
wakes, but it will not schedule `retireIfLanded` while the initiating run is still executing. The
run finalizer will preserve the terminal `done` state instead of unconditionally setting a successful
run's agent back to `active`; the normal supervisor retirement pass can then remove the worktree
after the run is no longer running. This prevents both process interruption and deleting a worktree
while the runtime still owns it.

### Keep finalization's failure semantics unchanged

The finalizer will continue to classify a missing or invalid report as empty/failed according to its
existing rules. The fix only prevents terminal cleanup from causing the missing report; a genuine
runtime failure or an externally interrupted run remains non-successful and remains visible to the
supervisor.

### Test the observed race through the run engine

Add a test that uses the existing fake runtime and ticket service to perform a terminal transition
from inside the active run, then returns a valid structured report. Assert the ticket is terminal,
the run is `succeeded`, `liveness` is the report's state-derived value, the stored summary and
`result_json` are present, and the worker is not live. Add a separate external-transition assertion
that an active run is still marked interrupted. The test's recorded fields provide the delivery
evidence for the mechanism rather than inferring behavior from source order alone.

## Risks / Trade-offs

- [Risk] A successful run could still overwrite the terminal worker state if finalization only uses
  the run's initial ticket snapshot. → Re-read the current ticket/agent state during finalization and
  preserve `done` for a terminal ticket.
- [Risk] Deferring retirement leaves a terminal worker visible briefly after its run completes. → The
  supervisor already retries terminal retirement and the worker is non-live immediately; this is
  safer than removing a live run's worktree.
- [Risk] A future caller may supply an incomplete actor identity. → Treat only an exact matching
  non-null `runId` as self-owned; all other active runs retain the existing interrupt path.

## Migration Plan

No migration is required. Deploy the code and regression tests together. If the change is reverted,
terminal transitions return to interrupting every active run, restoring the pre-fix race but requiring
no data repair.
