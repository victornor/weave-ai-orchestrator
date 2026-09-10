## Why

`packages/core/src/usage/usage.test.ts` fails nondeterministically: repeated runs of the file alone
show the `usage top / models / ticket` describe block's three window-based tests (`groups by model
and ticket with human labels, ordered by cost`, `groups ticket-less usage per agent instead of one
unknown bucket`, `aggregates per model with provider`) intermittently returning empty/wrong results.
Reproduced locally: 12-14 of every 15 runs fail one or more of these three cases. This erodes trust in
"tests pass" as a delivery gate for every ticket in the project.

## What Changes

- `packages/core/src/usage/usage.test.ts`: the three affected tests insert rows with
  `occurredAt: nowIso()` and immediately query `usage().top()`/`usage().models()` with
  `window: '24h'`. Both timestamps are millisecond-precision real wall-clock values computed only a
  few statements apart, and the window's upper bound is a strict `<` SQL comparison
  (`packages/core/src/usage/service.ts:148,208,236`), so whenever the insert and the query land in
  the same millisecond the inserted row's `occurred_at` ties the query's `end` exactly and is
  silently excluded from the window. This is a race against real time, not a data or ordering bug in
  the tests' assertions.
- Fix: freeze time in those tests with `vi.useFakeTimers()` / `vi.setSystemTime()` — the established
  idiom already used in the sibling `packages/core/src/usage/accounts.test.ts` and elsewhere in
  `packages/core` — and advance the frozen clock forward by a fixed amount between inserting the rows
  and issuing the query, so the query's `end` is always strictly after every row's `occurred_at`.
  This removes all dependence on real submillisecond timing; no assertion changes.
- No production code changes. No `retry`, `skip`, `only`, or timeout increase is used.

## Capabilities

### New Capabilities
(none — this is a test-file-only determinism fix with no product-facing capability)

### Modified Capabilities
(none — no spec-level behavior changes; the fix touches only test setup/timing, not
`usage_events` semantics, and every existing assertion is preserved)

## Impact

- `packages/core/src/usage/usage.test.ts` only. No changes to `packages/core/src/usage/service.ts`,
  `packages/shared/src/usage.ts`, or any other runtime code.
- No API, schema, or behavior change. No other package is affected.
