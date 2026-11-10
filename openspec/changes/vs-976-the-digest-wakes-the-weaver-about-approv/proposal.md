## Why

VS-956 made the claim re-check the unreviewed cards a digest names, yet on 2026-11-09/10 the weaver was still woken four times by a digest naming cards it had marked 14–78 seconds earlier (VS-972, VS-974 twice, VS-975). Each is a whole weaver turn that produces nothing.

Cause (read from `supervisor/pendingReview.ts`): `refreshQueuedDigests` skips every queued wake whose own `source` is not `system`. A digest is enqueued with `source: 'system'`, but `wake.enqueue` coalesces it into whatever wake is already queued for the weaver; when that wake is a worker report, a decision answer or a human message, the digest sits only as a bundle entry of a non-system row and is never re-checked. The number is therefore stale (computed at enqueue, delivered later), not wrong: the same query, run at delivery, agrees with the "Open decisions" list.

## What Changes

- The claim-time re-check applies to every queued weaver wake, whatever its own source; the digest is found by its `pendingReview` payload (top level or bundle entry), not by the carrier's source.
- The same re-check runs again in the run engine right before the weaver's prompt is built, because a fifth occurrence (04:01:40Z, VS-976's own plan card, digest source `system`, age `0s`) showed the claim itself can precede the mark: an age left at the enqueue value means the claim-time check ran before the mark or found the card still unseen. Live rows were not inspected, so the claim-to-render gap is the best-fit explanation, not a proven one.
- A card with no review mark is still named; nothing about how real unreviewed cards are reported changes.

## Capabilities

### Modified Capabilities
- `worker-supervision/conductor-digest`: the not-reviewed list is current at delivery regardless of which wake the digest was coalesced into.

## Impact

`packages/core/src/supervisor/pendingReview.ts` and its test. No schema or API change. The same enqueue-time-snapshot weakness exists for any other wake payload baked at enqueue; only the digest's `pendingReview` list is affected today (the other digest content is event history, which cannot go stale).
