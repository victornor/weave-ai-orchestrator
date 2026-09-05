## Why

When a worker's automatic retries are spent, the run engine parks it and raises a `retry_approval`
decision so the human can retry it, move it to another runtime, or cancel the ticket. That decision
can never be written: `decisions.kind` is constrained to seven values and `retry_approval` is not one
of them, so the insert fails on the CHECK constraint. The engine catches the error and logs it at
`warn`, having already paused the worker — so the worker is paused, the ticket is left where it was,
no card reaches the human, and nothing on any surface says why the work stopped. Every stuck worker
in this workspace is currently invisible.

Confirmed on `main` at `1ff95c8`: replaying every migration into a fresh database and inserting a
`retry_approval` row fails with `CHECK constraint failed: kind IN ('approval',…,'discard_approval')`,
while the other seven kinds get past the CHECK.

## What Changes

- A new additive migration rebuilds the `decisions` table so its `kind` CHECK accepts every value in
  `DECISION_KINDS`, preserving all existing rows, both indexes and the foreign keys. SQLite cannot
  alter a CHECK in place, so the table is rebuilt inside the migration's existing transaction.
- The run engine's parking path is made loud and step-independent: a failure to raise the retry card
  is logged at `error` with the run, agent and reason, and no longer prevents the ticket from being
  moved to `blocked` or the quota retry from being booked. The retry ladder, its timings and the
  conditions under which a worker is parked are unchanged.
- Tests pin the invariant: the persisted CHECK is asserted against `DECISION_KINDS` so the two cannot
  drift again, the migration is proved on a database seeded with existing decisions, and the engine's
  exhausted-retries path is proved to produce a `retry_approval` decision that reaches the human's
  open list.

## Capabilities

### New Capabilities
- `run-recovery/stuck-worker-parking`: what the system does when a worker's automatic retries are
  spent — it pauses the worker, puts a retry / switch-runtime / cancel choice to the human as a
  decision on the ticket, blocks the ticket, withdraws the card when the worker recovers, and never
  loses that card silently. Includes the storage guarantee that every decision kind the system
  defines can actually be persisted.

### Modified Capabilities
<!-- None. `human-decisions/option-cards` already covers how a decision with options is rendered and
     answered; the retry card is one such card and changes none of its requirements. -->

## Impact

- `packages/db/src/migrations/` — one new migration file rebuilding `decisions`.
- `packages/db/src/migrations.test.ts` — migration and drift tests.
- `packages/core/src/runs/engine.ts` — `parkForHuman` logging and step independence.
- `packages/core/src/runs/` tests — the exhausted-retries path.
- No API, wire-shape, CLI or web change. `DECISION_KINDS` in `packages/shared/src/enums.ts` is already
  correct and is not changed.
- Deployment: the migration applies on the daemon's normal startup migrate, so a normal
  `conductor daemon upgrade` is sufficient. Existing decisions are preserved; there is no backfill,
  because no `retry_approval` row was ever written.
