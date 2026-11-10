## 1. Implementation

- [x] 1.1 Make `refreshQueuedDigests` re-check queued wakes of every source, not only `system`

## 2. Tests

- [x] 2.1 Cover a digest coalesced into a non-system wake: a card marked after queueing is dropped, a card left unmarked is still named, and a non-digest wake is left untouched
