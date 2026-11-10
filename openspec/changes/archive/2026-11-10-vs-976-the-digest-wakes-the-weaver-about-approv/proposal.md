## Why

On 2026-11-09/10 the weaver was woken five times by a digest naming cards it had marked 14–78 seconds earlier (VS-972, VS-974 twice, VS-975, VS-976). Each is a whole weaver turn that produces nothing.

None of the five can be attributed to the code on `main`: VS-956 (the claim-time re-check, `f4b79dc5`) landed after the running daemon's release (`85af8569`) was built, so it has never executed on this host, and the observed wakes come from the code before it. This change fixes a latent defect found by reading VS-956, and is only testable on a host after a daemon upgrade.

Latent defect (read from `supervisor/pendingReview.ts`): `refreshQueuedDigests` skips every queued wake whose own `source` is not `system`. A digest is enqueued with `source: 'system'`, but `wake.enqueue` coalesces it into whatever wake is already queued for the weaver; when that wake is a worker report, a decision answer or a human message, the digest sits only as a bundle entry of a non-system row and is never re-checked. The number is therefore stale (computed at enqueue, delivered later), not wrong: the same query, run at delivery, agrees with the "Open decisions" list.

## What Changes

- The claim-time re-check applies to every queued weaver wake, whatever its own source; the digest is found by its `pendingReview` payload (top level or bundle entry), not by the carrier's source.
- A card with no review mark is still named; nothing about how real unreviewed cards are reported changes.

## Capabilities

### Modified Capabilities
- `worker-supervision/conductor-digest`: the not-reviewed list is current at delivery regardless of which wake the digest was coalesced into.

## Impact

`packages/core/src/supervisor/pendingReview.ts` and its test. No schema or API change. The same enqueue-time-snapshot weakness exists for any other wake payload baked at enqueue; only the digest's `pendingReview` list is affected today (the other digest content is event history, which cannot go stale).
