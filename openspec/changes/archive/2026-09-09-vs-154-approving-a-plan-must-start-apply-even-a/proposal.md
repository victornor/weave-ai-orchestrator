## Why

Captain approved VS-146–149 around 2026-09-09 17:33. None started apply until the conductor relaunched them by hand at 17:45. The platform-engineer role was still paused from a 2026-09-08 budget halt; `roles.resume` at 17:36 flipped the role to active and emitted an event, but did not start those turns.

The `approved` transition already wakes the worker (`packages/core/src/tickets/service.ts`). Gate 2 of `wake.enqueue` (`packages/core/src/wake/index.ts`) writes that wake as `skipped` / `role_paused` and sets `finishedAt`. A skipped wake is terminal. The dispatcher never sees it. `roles.resume` only updates the role row. The supervisor's liveness scan also goes through `enqueue`, so its `liveness_repair` wake (idempotency key `liveness:<ticketId>:<status>`) is skipped the same way; Gate 0 then treats that skipped row as the winner of the key, so after resume the scan cannot re-enqueue. Changing the workers' model/runtime around the same time was not the block — a runtime change already retires the old session (`packages/core/src/sessions/index.ts`) — but the next turn never came because no wake landed.

## What Changes

- A wake for a worker whose role is paused is **queued**, not skipped. The pause still holds the turn: the dispatcher does not claim it until the role is `active` (same pattern as an expired runtime login, which already leaves wakes `queued`).
- `roles.resume` does not need to reconstruct skipped rows. Queued wakes become eligible on the next dispatcher tick once the role is active.
- Gate 0 (idempotency) no longer treats a `skipped` (or `cancelled` / `failed`) row as satisfying the key, so a later enqueue of the same key can actually queue. That is what made liveness unable to recover this incident after resume.
- Approving a plan after the worker's runtime/model has changed still starts apply; the apply turn uses the workers setting in force at launch (already specified by `model-selection/turn-resolution`; this change pins it with a regression test). A fresh session is fine; sitting idle is not.
- `docs/PLAN.md` §7.1 Gate 2 is updated so it no longer says a paused role skips the wake.

No API, CLI, or schema change. No backfill of wakes already skipped before this ships.

## Capabilities

### New Capabilities

- `run-recovery/role-pause-wakes`: a wake for a worker whose role is paused stays queued until the role is active; resume starts those turns without a manual relaunch; skipped rows do not consume an idempotency key.

### Modified Capabilities

- `model-selection/turn-resolution`: add a scenario that a plan approved after the workers runtime has changed still launches apply on the runtime in force at launch.

## Impact

- `packages/core/src/wake/index.ts` — Gate 2 (`role_paused`); Gate 0 (idempotency vs skipped/cancelled/failed).
- `packages/core/src/runs/dispatcher.ts` — do not claim a worker whose role is paused.
- `packages/core/src/wake/wake.test.ts`, `packages/core/src/runs/dispatcher*.test.ts` (or a colocated integration test), `packages/core/src/tickets/` / `packages/core/src/sessions/` tests as needed for the two acceptance journeys.
- `docs/PLAN.md` §7.1.
- No change to `roles.resume` itself, session persistence within the same runtime, or auto-approving plans.
