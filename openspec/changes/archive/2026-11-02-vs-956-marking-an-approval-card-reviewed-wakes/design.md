## Context

`conductorDigest` calls `pendingReviewEntries()` synchronously, so the read is fresh at enqueue; the staleness is the gap between enqueue and the weaver's next turn, during which `wake.enqueue` leaves the row `queued` (or coalesces it into an earlier queued wake's `bundle`).

## Decision

Refresh at claim, in `dispatcher.claim`, inside the existing transaction, for weaver agents only. A helper `refreshQueuedDigests` rewrites the wakeup row's `reason` and `payload_json` (top-level and bundle entries with `source: 'system'` and a `pendingReview` array) so every later reader (turn prompt, `weave_inbox`) sees the corrected data.

Rejected alternatives: cancelling a queued digest from `decisions.review` (leaves the other digest events unreported and couples review to the wake queue); suppressing the whole digest when the list empties (the digest still carries real events).

The digest wake itself is not suppressed: it carries other events. Only the false claim is removed.

## Risks

An unmarked card is unaffected: the refresh keeps every card still `open` + `human` + `unseen`. A decision query failure would abort the claim transaction; the query is a plain indexed `IN (ids)` lookup on at most 10 ids.
