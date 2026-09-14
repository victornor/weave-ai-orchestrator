## Why

The merge queue admits waiting tickets strictly in join order, so a critical fix approved last waits behind every earlier ticket at roughly one merge per fifteen minutes. On 2026-09-14 a critical fix (VS-388) sat seventh in an ~80-minute queue behind six UI PRs. Ticket `priority` is never consulted for admission; it only decides what gets built, so an urgent fix cannot overtake earlier medium-priority merges.

## What Changes

- Waiting admission orders by priority — `critical`, `high`, `medium`, `low` — and among equal priorities by the moment the ticket joined, breaking ties by ticket number.
- A ticket already in the active merge step is never pre-empted; only the order of waiting tickets changes.
- Starvation by bypasses, not wall-clock age: at each admission every waiting ticket that joined earlier is credited one bypass, and a ticket that has been bypassed three times sorts ahead of every non-starved ticket, in join order. A slow queue is not evidence of being bypassed, so a queue full of long-waiting tickets does not outrank a fresh critical.
- Changing a waiting ticket's priority takes effect at the next admission, with no other action.
- The queue report carries each entry's `priority` and whether it jumped ahead of an earlier join; the V1 merge-queue page labels a jumped-ahead row with its priority.
- The V2 Work merge strip names the ticket the queue would admit next, and its priority when that ticket jumped ahead. It stays a single line and truncates gracefully; it keeps whatever the active-merge wait suffix (VS-391) contributes once that lands.
- `docs/PLAN.md` §11.4 and a new ADR record the priority ordering, which supersedes ADR 0006's explicit first-in-first-out consequence.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities

- `ticket-delivery/merge-queue`: waiting tickets are admitted by priority and join order instead of join order alone, with a bypass-count starvation rule; the queue report carries each waiting entry's priority and whether it jumped ahead; the web view labels a jumped-ahead row.
- `web-v2/work`: the merge queue strip names the next waiting ticket and its priority reason, in addition to its landing and waiting counts.

## Impact

- `packages/shared`: a pure waiting-order comparator (priority rank, join time, ticket number, bypass count) used by both the daemon and the web app, so the two cannot drift; `mergeBypasses` on `Ticket`.
- `packages/db`: migration `0039` adds `tickets.merge_bypasses` (integer, default 0), exposed camel-cased as `mergeBypasses`.
- `packages/core/src/tickets/merge-queue.ts`: `waitingOf` ordering, the bypass increment on admission, the `ahead` computation, and the `MergeQueueEntry` shape (`packages/core/src/api.ts`).
- `packages/ui`: `api/types.ts`, the V1 merge-queue page row, and the V2 Work merge strip (`lib/board.ts` `mergeStrip`, `v2/work/Work.tsx`).
- `docs/PLAN.md` §11.4, `docs/API.md`, and a new ADR superseding ADR 0006's FIFO consequence.
- Tests: shared comparator unit tests, core merge-queue ordering/starvation/reprioritisation tests, a V1 row component test, and V2 strip component tests.
- Collision: PR #327 (VS-391) also edits `mergeStrip` and the Work strip; rebase onto it once landed and keep both pieces of information on the one strip line.
