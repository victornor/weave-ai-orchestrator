## 1. Shared predicate

- [x] 1.1 Add `incompleteDelivery(ticket)` to `packages/shared/src/types.ts` next to `landingBranchOf`, taking `Pick<Ticket, 'status' | 'delivery'>`, implementing design.md Decision 1 (done + claimed merge + missing `merged: true` or a non-empty trimmed `mergeCommit`). Export is already covered by `export * from './types.js'`. Verify with tests in `packages/shared/src/types.test.ts`: the VS-227 shape (`prState: 'merged'`, no `merged`, no SHA) is incomplete; `merged: true` plus a SHA is not; `merged: true` with a null/blank SHA is incomplete; a `done` ticket with null delivery, or a PR whose `prState` is not `merged`, is not.

## 2. Close the merging → done bypass

- [x] 2.1 In `packages/core/src/tickets/guards.ts` `checkTransition`, reject `from === 'merging' && to === 'done'` with `invalid_disposition` and a message that names `ac_ticket_merge_done`. Do not remove the edge from `TRANSITIONS`. Verify: a `change` (and a `task`) ticket in `merging` transitioned to `done` throws, stays `merging`, and the error message names merge-done (`packages/core/src/tickets/tickets.test.ts`).
- [x] 2.2 Update the state-machine test ("matches the shared transition table exactly when every guard is satisfied") so `merging → done` is graph-legal (`canTransition` true) but the `transition()` call is expected to fail the new guard; other edges stay as they are. Verify that test passes and that `mergeDone` still finishes a `merging` ticket as `done` with a complete delivery (`merge-done.test.ts` existing cases still pass).

## 3. Surfaces

- [x] 3.1 In `packages/ui/src/components/TicketCard.tsx` `outcomeOf`, if `incompleteDelivery(ticket)` return `{ label: 'delivery incomplete', tone: 'failed' }` before the existing `merged` / `prUrl` branches. Verify in `packages/ui/src/test/components.test.tsx`: a done ticket with the VS-227 delivery shows `delivery incomplete` and not `PR merged` or `merged`; a done ticket with `merged: true` and a SHA still shows `merged`.
- [x] 3.2 On the ticket detail header in `packages/ui/src/routes/TicketPage.tsx` (the badge row next to kind / interactive / folded status), render `OutcomeChip` for a `done` or `cancelled` ticket. Verify in `packages/ui/src/test/ticketpage.test.tsx` that a done ticket with the VS-227 delivery shows `delivery incomplete`.
- [x] 3.3 In `packages/cli/src/commands/ticket.ts` `ticket show`, add a `delivery` row to the printed fields: incomplete → `incomplete — merged PR, no mergeCommit` (or `incomplete — merged, no mergeCommit` when there is no PR URL); complete with a SHA → the SHA; otherwise omit the row. Verify with a unit test of a small exported formatter (e.g. `deliveryShowValue(ticket)`) covering those three cases; `conductor doctor` is untouched.

## 4. Verification

- [x] 4.1 Confirm `packages/core/src/tickets/land.ts`, `packages/server/src/upgrade-announce.ts`, and `packages/cli/src/commands/doctor.ts` are not in the diff. `pnpm lint && pnpm typecheck && pnpm test` green. Paste both suite blocks verbatim in the PR and the ticket comment (core/server and UI, never summed).
