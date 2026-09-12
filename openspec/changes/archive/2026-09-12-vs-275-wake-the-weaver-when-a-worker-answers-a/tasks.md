## 1. Core: wake the weaver on a worker comment

- [x] 1.1 In `packages/core/src/tickets/service.ts`'s `comment()`, after the comment row is inserted, add a branch: when `actor.kind === 'agent'` and `actor.id` is set and is not `conductorId()`, look up the ticket's open decisions (`deps().decisions.list({ ticketId: t.id, status: ['open'] })`), and if any carries `weaverReviewStatus === 'concerns'` enqueue exactly one wake for `conductorId()` — source `ticket_comment`, a reason naming `t.identifier` and stating the held review was answered, and payload `{ ticketId: t.id, commentId: c.id, decisionId: <that decision's id> }`. Place it as an `else if` after the existing human-comment branches so those are unchanged.
- [x] 1.2 Verify the wake does not mutate review state: a unit test with an open `plan_approval` marked `concerns`, a worker comment, then assert the decision row still reads `status: 'open'`, `weaverReviewStatus: 'concerns'`, `weaverReviewNote` unchanged, and `weaverReviewedAt` unchanged.
- [x] 1.3 Verify one wake per comment even with two marked decisions: seed two open decisions on one ticket both marked `concerns`, post one worker comment, assert exactly one wake for `h.conductorId` on `ticket_comment`.

## 2. Core: the cases that must not wake

- [x] 2.1 Absence: a worker comment on a ticket whose decisions are unmarked or marked `looked` enqueues **no** weaver wake — assert the absence (`wake.calls.some(...) === false`), not only the presence.
- [x] 2.2 A worker comment on a ticket whose only `concerns`-marked decision is answered (and one on an open `looked` decision) enqueues no weaver wake.
- [x] 2.3 A comment authored by the weaver itself (`actor.id === h.conductorId`) on a ticket with an open `concerns`-marked decision enqueues no weaver wake.
- [x] 2.4 A worker's `status` comment on a held ticket wakes the weaver (proves the kind filter is not applied).

## 3. Core: pin existing comment routing

- [x] 3.1 Regression test: a human comment on a ticket with a live worker still wakes that worker on `ticket_comment` and produces no weaver wake from this change; a human comment on a ticket with no role still reaches the weaver through the existing no-role path.
- [x] 3.2 Confirm the existing test "wakes the worker on a human comment but not on an agent comment" still passes unchanged (a worker comment on a ticket with no marked decision remains wake-free).

## 4. Verification

- [x] 4.1 `pnpm lint` clean.
- [x] 4.2 `pnpm typecheck` clean (the full chain, not the ui filter alone).
- [x] 4.3 `pnpm test` — run both suites and report **both** blocks verbatim: the core/server suite and the `@agent-conductor/ui` suite, with real totals, per this project's standing rule.
