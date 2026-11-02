## Why

The weaver marks an approval card reviewed (`weave_decision_review`), and about 15 seconds later is woken by a digest saying that very card is "still not reviewed". Seen twice on 2026-11-02 (VS-955 plan and merge cards). Each false wake re-sends the whole weaver session and produces nothing.

Cause (read from `supervisor/index.ts` `conductorDigest` and `wake/index.ts`): the digest builds its unreviewed list and bakes it into the wake `reason` and `payload` at enqueue time. When the weaver is mid-turn the wake stays `queued` until the turn ends, and the weaver's own mark lands in between. The quoted age ("plan 7s") is the card's age at enqueue, shorter than the gap, which is the tell. The mark itself schedules no digest wake; the only thing it triggers is `tickets.onReviewLooked`.

## What Changes

- When the dispatcher claims a weaver's queued wakes, any digest wake (top-level or coalesced bundle entry) that names unreviewed cards is re-checked against the database: cards no longer open, human-owned and `unseen` are dropped, the count, names and ages in the reason and `pendingReview` payload are recomputed, and the note disappears when none remain.
- A card genuinely still unmarked is still reported; a card marked with `waitingOn` has status `looked` and is not reported.
- The note formatting moves to a small shared module used by both the supervisor and the dispatcher.

## Capabilities

### Modified Capabilities
- `worker-supervision/conductor-digest`: the digest's "not reviewed" list must be current at delivery, not only at enqueue.

## Impact

`packages/core/src/supervisor/index.ts`, `packages/core/src/runs/dispatcher.ts`, new `packages/core/src/supervisor/pendingReview.ts` with tests. No schema or API change.
