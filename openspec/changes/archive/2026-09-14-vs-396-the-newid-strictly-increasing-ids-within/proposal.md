# Make the newId monotonicity test deterministic

Tracker change for [VS-396](weave://tickets/VS-396). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

`packages/db/src/id.test.ts > newId > issues strictly increasing ids within a millisecond` fails
intermittently in GitHub Actions `test-core` on unrelated branches, while `main`'s own CI stays
green. On 2026-09-14 it failed on VS-375 (run 34799385641) and VS-385 (run 34800676983), both with
`AssertionError: expected 17893533689xx to be 17893533689xx+1` at the
`decodeTime(ids[0]) === decodeTime(ids.at(-1))` assertion.

The test builds a 64-id batch and requires every id to share one millisecond, retrying once when the
batch crosses a clock tick. On a loaded runner running many test files in parallel, both attempts
can span a tick — the failure is the test's wall-clock assumption, not the code. Each false failure
forces a full CI rerun (about 7 minutes), and the merge queue is serial, so every rerun delays every
waiting merge.

The investigation found no real bug: `newId` is `monotonicFactory()` from `ulid`
(`packages/db/src/db.ts:119`), which increments the random component while the millisecond is
unchanged and therefore yields strictly increasing ids within a millisecond.

VS-392 (#330, merged 2026-09-14 as `47ffb26b`) landed independently and already removed the flake
there too — it also froze the clock, at a past instant (`1_700_000_000_000`, 2023) and asserted the
boundary in the same test. That fixes the common case but carries the same class of trap in
reverse: the process-wide monotonic factory never moves `lastTime` backwards, so once anything in
that module instance has issued an id at the real clock, freezing to a past instant is ignored
(`lastTime` stays at the real value) and the `decodeTime(next) === ms + 1` assertion fails. This
change supersedes that test body: a future `BASE` guarantees the factory always advances to the
frozen instant, and the boundary check is its own test. In short, VS-392 removed the flake; this
change hardens the test against the past-date trap rather than duplicating the fix.

## What changes

- **The test controls time instead of racing it.** `vi.useFakeTimers()` + `vi.setSystemTime(BASE)`
  freezes `Date.now()` for the batch, so all 64 ids provably share one millisecond; a real timers
  restore runs in `afterEach`. `BASE` is a fixed instant ahead of any real clock so the
  process-wide monotonic factory always advances to it, even if another test already issued an id.
- **Within the frozen millisecond, the strict monotonicity check is kept unchanged** — the
  `ids[i] > ids[i-1]` loop, asserted with `toBe(true)`.
- **A second test asserts the boundary behaviour** explicitly: two batches either side of a
  millisecond (`BASE`, then `BASE + 1`) increase strictly within each batch and across the boundary.
- **The assertions pin the controlled clock**, not just the order: `decodeTime` of each batch is
  asserted equal to `BASE` / `BASE + 1`, so a test that silently stopped controlling the clock would
  fail loudly instead of passing by luck.

## Out of scope

- Any change to `newId` itself — it is monotonic; the ticket's "test-only unless a real bug" scope
  holds.
- More retries, a longer batch or a widened tolerance: all the weaker alternatives the ticket rules
  out.
- `.github/workflows/ci.yml`, which VS-393 and VS-392 are changing.
