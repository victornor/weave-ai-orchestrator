# Tasks — VS-472

## 1. Stop the every-pass waiting comment

- [x] 1.1 `packages/core/src/tickets/service.ts`: add `recordAutoMergeHold(ticket, reason, head)` and `clearAutoMergeHold(ticket)`, storing `{ reason, head, at }` under `delivery.autoMergeHold` and posting the comment only when the pair is new. Verify with `pnpm vitest run packages/core/src/tickets/auto-merge-hold.test.ts`
- [x] 1.2 Rework `autoMergeSweep` to route both hold sites (`CI is red on the PR`, `the weaver has concerns`) through `recordAutoMergeHold`, capturing the pass's `prState.headSha` and falling back to `resolveDeliveryHead(t)`; clear the hold after a successful advance. Verify the existing `pnpm vitest run packages/core/src/tickets/yolo.test.ts` still passes

## 2. Tests

- [x] 2.1 `packages/core/src/tickets/auto-merge-hold.test.ts`: three sweeps over a concerns-held YOLO ticket produce exactly one waiting comment; a new head still held produces one more; a switch from concerns to CI red produces one more; a fresh service over the same database with the same reason and head adds none; an advance clears the hold so a later identical hold comments again

## 3. Audit the sweep's other comment sites

- [x] 3.1 Confirm no other every-pass comment remains in `service.ts`: `recordArchiveLandingFailure` already dedupes per `(reason, pull request)`, `raiseArchiveBackfillCard` raises a decision. Record the finding in the ticket report

## 4. Verify

- [x] 4.1 `pnpm lint && pnpm typecheck` clean
- [x] 4.2 `pnpm test` green — paste both the core/server and UI suite blocks verbatim in the report
- [x] 4.3 Scratch daemon: hold a YOLO ticket ~2 minutes, paste the comment count before (≈8) and after (1)