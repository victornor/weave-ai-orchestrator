## Why

When a worker's retries are spent it is parked and a human-owned `retry_approval` card is raised on
its ticket. Nothing closes that card when the worker is put back to work: on 2026-09-20 the weaver
relaunched VS-620 and VS-614's workers (the digest said "was resumed"), and both cards stayed open in
Needs you recommending Retry while the workers were already running again. Answering one would start
a second turn on top of a healthy one.

## What Changes

- **Stop cards close when the worker goes back to work.** Resuming or relaunching a worker — by the
  human, by the weaver's `weave_worker_relaunch`, or automatically after a daemon restart — closes
  every open decision that describes that worker being stopped: its parking card and the supervisor's
  stalled-worker escalation. The card is recorded as closed with a note naming what closed it (for
  example "the worker was resumed by the weaver at <time>"), so it leaves Needs you and its count.
- **A late answer starts nothing.** If the human answers a parking card in the window before it is
  closed, or after the worker is already running, no turn is started, no retry is booked and no
  catalog option is changed. The daemon records plainly that nothing was started and why, instead of
  silently discarding the answer. Cancelling is treated the same way: the card is stale, so it acts
  on nothing.
- **A new failure still raises a fresh card.** With the old card closed there is nothing to supersede,
  so a worker that fails again after the resume gets a new parking card exactly as it does today.
- **The other worker-failure/stall decisions are audited and listed.** Of the audited kinds, the
  supervisor's stalled-worker escalation shares the resume mechanism and is fixed with the parking
  card; the engine's empty-turns finding and the runtime login-outage findings do not, and design.md
  records why.
- **No close of an answered card and no close of any approval other than a worker-stop card.** Plan,
  merge, action, promotion, hire and discard approvals are untouched.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `run-recovery/stuck-worker-parking`: the parking decision is closed when its worker is resumed or
  relaunched, and an answer that reaches it after the worker is running starts nothing.
- `worker-supervision/stalled-worker-detection`: resuming or relaunching a stalled worker closes its
  open escalation.

## Impact

- Code: `packages/core/src/decisions/service.ts` (a supersede-with-reason close and the stale-answer
  guard), `packages/core/src/api.ts` (the service method), `packages/core/src/workers/index.ts`
  (`resume`, `relaunch`), `packages/core/src/supervisor/index.ts` (`bootRecovery`).
- Tests: `packages/core/src/workers/workers.test.ts`, `packages/core/src/runs/engine.test.ts`,
  `packages/core/src/supervisor/supervisor.test.ts`, `packages/ui/src/test/events.test.tsx`.
- No schema change, no new decision kind, no new route, no UI design change. Needs you already reads
  decisions filtered to `status: 'open'`, and the VS-140 event patch already drops a `superseded`
  decision from that cached list without a refetch.
