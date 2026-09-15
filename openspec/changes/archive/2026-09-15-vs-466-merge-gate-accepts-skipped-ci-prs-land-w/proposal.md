## Why

VS-464 measured 4 of the last 10 landings (VS-439, 441, 447, 446) reaching `main` with no successful
`pull_request` CI run; on PR #380 (VS-446) and PR #379 (VS-447) every check run on the merged head is
`completed/skipped`. The merge gate reads the forge's rolled-up check state, and that rollup treats a
`SKIPPED` conclusion as a pass, so an all-skipped draft run satisfies the required-check gate and
untested code lands. The worker's local suite is then the only test.

## What Changes

- The forge's rolled-up check state (`packages/core/src/forge/gh.ts`) no longer counts `SKIPPED`,
  `NEUTRAL`, `CANCELLED`, `STALE`, in-progress or missing conclusions as a pass. `success` requires a
  completed `SUCCESS` for every check a run actually reported; an all-skipped rollup is **not**
  resolved checks.
- The landing gate (`packages/core/src/tickets/archive-before-merge.ts`) requires the resolved checks
  to be for the **exact head SHA** the landing produces, and never merges a repository that has CI
  workflows on an absent rollup — it waits (retryable `checks_pending`) instead. A repository with no
  CI, and the existing bounded grace for a forge that cannot classify one, are unchanged.
- The landing sequence brings the draft pull request **out of draft before** the rebased/archived head
  is pushed, so the push is a push to a non-draft pull request and the run it starts evaluates the
  head that will land — instead of a run whose all-skipped jobs the gate used to accept.
- The damage of the last 7 days is audited and reported on the ticket, with a fresh CI run on current
  `main`.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — a task ticket's tracker change; `skip_specs: true`)

## Impact

- `packages/core/src/forge/gh.ts` — `rollupState`, `checkState`/`checkTally` mapping and their tests.
- `packages/core/src/tickets/archive-before-merge.ts` — the landing gate and its tests.
- No schema, route, config or UI-contract change. `ForgeAdapter`'s `ForgeCheckState` union is
  unchanged; only which inputs map to `success` is.
- `packages/core/src/supervisor/index.ts` and `tickets/service.ts`'s auto-merge sweep consume
  `ciState`; an all-skipped head now reads `none` rather than `success`, so neither wakes a worker on
  a false pass. The merge gate is the enforcement point and is the only behavior change that lands a
  ticket.
