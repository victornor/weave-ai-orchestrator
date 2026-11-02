## 1. Implementation

- [ ] 1.1 Add `supervisor/pendingReview.ts` (shared note builder and `refreshQueuedDigests`) and use the builder in the supervisor digest
- [ ] 1.2 Call `refreshQueuedDigests` from `dispatcher.claim` for weaver agents

## 2. Tests

- [ ] 2.1 Cover a card marked after queueing (with and without waitingOn), an unmarked card still reported, a coalesced bundle entry, and an answered card
