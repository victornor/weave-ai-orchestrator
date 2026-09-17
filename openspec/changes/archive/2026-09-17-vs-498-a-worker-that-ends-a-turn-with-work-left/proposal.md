## Why

VS-202 already detects a worker whose turn ended cleanly with nothing left to wake it
(`stalledWorkers()`/`stalledWorkerScan()`, `worker.stalled` event) — but detection is where it stops.
The event is a one-shot digest entry that scrolls out of the next digest window; nothing re-asserts
"still stalled" on later cycles, nothing ever resumes the worker, and every live status surface
(board, ticket card, worker card — all already have a `stalled` UI status defined and wired end to
end through `agentUiStatus`/`ticketUiStatus`) keeps reading `active`/the ticket's working status,
because none of the routes that build those views ever set the `stalled` flag those functions accept.
VS-495 sat idle for 29 minutes, reported `active` throughout, until the human noticed. A supervision
system whose failure mode is "the human noticed" has a hole in it.

## What Changes

- The stalled-worker sweep (VS-202) gains a bounded automatic recovery step: on detecting a stall it
  wakes the *same* worker agent to continue its ticket, up to a small configurable cap of attempts.
  It reuses the existing `wake.enqueue()` funnel and the existing agent row — no new agent, no new
  worker, `tickets.worker_id` never changes — so the pending-spawn sweep's `worker_id IS NULL` guard
  keeps this ticket out of its consideration the whole time.
- Recovery attempts are counted per worker, reset whenever a run since the last attempt produced
  observable evidence of progress on the ticket (the same evidence test the stuck-worker gate already
  uses), so a worker that is actually moving is never penalized for pausing once.
- Once the cap is exhausted, the sweep stops auto-recovering and raises a `gate_finding` decision
  owned by the weaver — the same escalation shape the stuck-worker gate and the retry ladder already
  use — naming the worker, the ticket and how many recovery attempts were made. The existing "no open
  decision" exclusion in the stall predicate then keeps the worker out of further detection until the
  weaver acts, so the same worker is never escalated twice for the same stall.
- The daemon persists the "this worker is in an active stall/recovery cycle" fact (first detected,
  attempt count, whether escalated) instead of only emitting a transient event, so it survives past
  one digest cycle and can be read back.
- Every surface that renders a worker's or a ticket's live status is wired to that persisted fact, so
  a stalled worker renders with the existing `stalled` UI status (already defined, already styled,
  never populated) instead of reading as `active`/its ticket's ordinary working status.

## Capabilities

### New Capabilities
(none — this extends existing capabilities rather than introducing a new one)

### Modified Capabilities
- `worker-supervision/stalled-worker-detection`: detecting a stall now triggers a bounded automatic
  recovery wake to the same worker instead of never enqueueing one; the persisted stall/recovery state
  and its escalation are added as new requirements under this capability.
- `worker-supervision/worker-activity`: the workers read and workspace stream gain the persisted
  stalled fact so a client can tell a stalled worker apart from a working one without inferring it
  from timing.

## Impact

- `packages/core/src/supervisor/index.ts` — `stalledWorkerScan()` grows the recovery/escalation step;
  new persisted state read/write.
- `packages/db/src/migrations/` — a new migration for the persisted stall/recovery state.
- `packages/core/src/decisions/` — a new `gate_finding` raised through the existing `decisions.create`
  path, correlation-keyed per worker.
- `packages/shared/src/config.ts` — a new workspace-configurable cap on automatic recovery attempts.
- `packages/server/src/presenter.ts`, `packages/presenter/src/views.ts` — the `agentUiStatus`/
  `ticketUiStatus` call sites that currently omit `stalled`/`workerStalled` gain it.
- `packages/render/src/entities.ts` (`workerToCard`, `ticketToSummary`) — no change to the functions
  themselves; only their callers change, since they already accept the flag.
- Tests: `packages/core/src/supervisor/` (recovery + escalation + no-duplicate-worker), a migration
  test, `packages/server/src/presenter.test.ts` (or equivalent), and the config schema test.
