## Context

`dispatcher.claim` calls `refreshQueuedDigests` on the weaver's queued wakes (VS-956). The function iterates `queued` and does `if (w.source !== 'system') continue`, assuming a digest always lives in a system row. `wake.enqueue` coalesces into the oldest queued wake of any source, so that assumption fails whenever something else is queued first.

## Decision

Drop the source filter. `refreshDigestWake` already returns null when a payload has no `pendingReview` array, so non-digest wakes are untouched. Bundle entries keep their `source === 'system'` check, since a digest entry is always system-sourced there.

## Alternatives

- Stop coalescing digests into other wakes: changes wake delivery semantics for a bug in the refresh.
- Re-check in the prompt renderer: leaves the stored wake and the rendered reason disagreeing.
