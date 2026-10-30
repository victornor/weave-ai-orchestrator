## Why

A ticket moved from `merging` to `blocked` loses `merge_queued_at` and `merge_started_at` (`mergeQueue.leave`). On 2026-10-30 VS-937 sat in that state for 6.5 hours: its merge approval was answered and CI was green, but its resumed worker only knew "queued, waiting for admission" and no admission could come. Four retry taps each re-sent ~197k uncached tokens into the same dead end, until the weaver re-transitioned the ticket by hand. VS-943 removes the commonest cause but not the state it leaves behind.

## What Changes

- Design choice: **restore on the way back** (option 2), not preserve the place. The queue stays a pure function of tickets that are in `merging`; a blocked ticket never holds a position that reorders or counts against others, and every existing leave/clear behaviour is unchanged.
- Answering a `retry_approval` (and `tickets.retry`) for a ticket blocked out of `merging` now returns it to `merging` — re-joining the queue — **before** the worker is relaunched, so the retried turn starts against a real queue entry. A refused restore is said on the ticket with the concrete repair instead of being swallowed.
- The weaver's digest ("Open work") gains a "Needs attention: stranded out of the merge queue" section for any ticket that is `blocked`, `blocked_from_status = merging`, with null queue timestamps, naming `weave_ticket_transition(<id>, "merging")` as the repair.
- A shared predicate `isStrandedMergeBlock` carries the definition.

## Capabilities

### New Capabilities
- `merge-queue-recovery`: how a ticket blocked out of the merge queue returns to it, and how a stranded one is surfaced.

### Modified Capabilities

## Impact

`packages/shared/src/merge-queue.ts`, `packages/core/src/decisions/service.ts`, `packages/core/src/tickets/service.ts`, `packages/core/src/prompts/index.ts`, with tests in `merge-queue.test.ts` and `render.test.ts`. No schema change.
