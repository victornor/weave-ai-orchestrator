## 1. Implementation

- [x] 1.1 Make `refreshQueuedDigests` re-check queued wakes of every source, not only `system`

- [x] 1.2 Re-run the check in the run engine just before the weaver's turn prompt is built, covering the gap between claim and render

## 2. Tests

- [x] 2.1 Cover a digest coalesced into a non-system wake: a card marked after queueing is dropped, a card left unmarked is still named, and a non-digest wake is left untouched
- [x] 2.2 Cover a digest already claimed: the row the prompt is built from is rewritten
