## 1. Land archive backfills without a card

- [x] 1.1 In `reconcileOpenSpecArchives` (supervisor), replace the `raiseArchiveBackfillCard` call and the approved-card retry with a `landArchiveBackfill(SYSTEM, …)` call for the pending archive PR; withdraw any open `merge_approval:archive:%` decision for the ticket first
- [x] 1.2 In `mergeDone`'s out-of-band archive path, land the returned pending PR via `landArchiveBackfill` instead of raising a card
- [x] 1.3 Remove `raiseArchiveBackfillCard` from `TicketService` (api + service); keep the answer/decline path for in-flight legacy cards

## 2. Tests

- [x] 2.1 archive-backfill test: done ticket + leftover change folder → PR opened and merged by the daemon, ticket `done`, zero decisions rows
- [x] 2.2 supervisor tests: sweep lands a pending archive PR with no card; withdraws a legacy open card; retries a deferred landing; convert the card-raising tests
- [x] 2.3 Test that shipped weaver prompts/skills never tell anyone to approve an archive backfill

## 3. Verify

- [x] 3.1 Run `pnpm test` (both suites), typecheck and lint; paste both suite blocks
