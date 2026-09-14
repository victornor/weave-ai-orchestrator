## 1. Shared ordering rule

- [x] 1.1 Add `packages/shared/src/merge-queue.ts` with `MERGE_BYPASS_LIMIT` (3), `mergePriorityRank`, `mergeQueueJoinedAt`, `mergeQueueJoinedEarlier`, `isMergeStarved` and the pure `compareMergeQueue(a, b)`, and export them from `packages/shared/src/index.ts`; verified with `pnpm vitest run packages/shared` and `packages/shared/src/merge-queue.test.ts` (priority order, equal-priority join order, number tie-break, starvation, null join time)
- [x] 1.2 Add `mergeBypasses` to the `Ticket` type in `packages/shared/src/types.ts`, add `priority` and `ahead` to `MergeQueueEntry` in `packages/core/src/api.ts`, mirror the entry fields in `packages/ui/src/api/types.ts`, and update the `MergeQueueEntry` shape in `docs/API.md`; verified with `pnpm typecheck`

## 2. Database

- [x] 2.1 Add `packages/db/src/migrations/0039_ticket_merge_bypasses.sql` (`ALTER TABLE tickets ADD COLUMN merge_bypasses INTEGER NOT NULL DEFAULT 0;`) and assert the column in `packages/db/src/migrations.test.ts`; verified with `pnpm vitest run packages/db`

## 3. Core queue admission

- [x] 3.1 Change `waitingOf` in `packages/core/src/tickets/merge-queue.ts` to fetch waiting rows and sort them with `compareMergeQueue`, and compute `ahead` per waiting ticket in `forProject`; verified the existing merge-queue suite still passes
- [x] 3.2 Credit bypasses in `pump`: after each successful admission, increment `merge_bypasses` for every remaining waiting ticket of the project that joined earlier (join time, number tie-break) than the admitted ticket, and clear `merge_bypasses` in `leave` and when `join` stamps a new queue entry; verified with core tests that a bypass is credited only on a real admission and never for time alone
- [x] 3.3 Add core tests: a critical joining behind six mediums that have waited over an hour (none bypassed) is admitted next; a low ticket bypassed three times is admitted before a newer critical; equal priorities keep join order; a lower-priority active merge is not pre-empted by a joining critical; raising a waiting ticket's priority reorders `forProject().waiting` and its position on the next admission; all pass
- [x] 3.4 Confirm the worker-hold case, the concurrency limit and the upgrade path still hold after the ordering change, and that `positionOf` reflects the new order; verified with the same suite green

## 4. V1 merge-queue view

- [x] 4.1 Show the priority as a short reason on a waiting row whose entry reports `ahead`, in `packages/ui/src/routes/MergeQueue.tsx`; verified with a component test in `packages/ui/src/test/mergeQueue.test.tsx` that a jumped-ahead row shows its priority and a join-order row shows none
- [x] 4.2 Confirm the V1 ticket badge and board strip need no new field (position already follows the backend order) and the existing badge/strip tests stay green; verified with `pnpm --filter @weave-ai/ui exec vitest run src/test/components.test.tsx src/test/board.test.tsx`

## 5. V2 merge strip

- [x] 5.1 Extend `mergeStrip` in `packages/ui/src/lib/board.ts` to return `next: { identifier, priority, ahead } | null`, computed with `compareMergeQueue` over the loaded tickets; verified with unit tests in `packages/ui/src/test/board.test.tsx` covering a jumped-ahead next ticket, a join-order next ticket, and no next ticket
- [x] 5.2 Render `· next: VS-123 (critical, jumped ahead)` (or `· next: VS-123`) in the V2 Work strip in `packages/ui/src/v2/work/Work.tsx`, keeping it one line that truncates; verified with component tests in `packages/ui/src/test/v2work.test.tsx` that the strip names the next ticket with its reason when it jumped ahead and without it otherwise
- [x] 5.3 Rebased onto main after VS-391 (PR #327) landed, combined its active-merge wait suffix and the next-ticket hint onto the one strip line (`mergeStrip` now returns `active` and `next`; the V2 strip renders both), and kept both component tests; verified `pnpm --filter @weave-ai/ui exec vitest run src/test/board.test.tsx src/test/v2work.test.tsx` green and `openspec validate --strict` clean

## 6. Documentation

- [x] 6.1 Add `docs/adr/0021-merge-queue-priority.md` recording priority-first admission with the bypass-count starvation rule, why it supersedes ADR 0006's first-in-first-out consequence (admission already re-syncs the branch), and updated ADR 0006 with a pointer; verified the file exists and ADR 0006 links to it
- [x] 6.2 Update `docs/PLAN.md` §11.4's queue-admission sentence to the priority-then-join-order rule and the bypass-count starvation rule; verified the section no longer says admission is by join order alone

## 7. Verification

- [x] 7.1 Run `pnpm lint` and `pnpm typecheck`; both clean
- [x] 7.2 Run `XDG_CONFIG_HOME="$(mktemp -d)" pnpm test`; both suites green (core 209 files/3230 tests, UI 153 files/2216 tests) and pasted verbatim in the ticket comment
