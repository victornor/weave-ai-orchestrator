## Why

Incident 01M37AX2FQTG6121QYSBH82KEM: `weave_ticket_merge_done(VS-665)` returned `ok:true` with
`delivery.merged:true` and moved the ticket to `done`, but nothing was merged — PR #534 is still
`OPEN`/draft, `mergedAt: null`. `mergeDone`'s landing block is gated by `if (t.projectId)`; when a
ticket's `project_id` is NULL (the gap VS-668/VS-670 later fixed at create/assign time), the entire
landing section — including its warning log — is skipped, and execution falls straight through to
the terminal step that unconditionally writes `delivery.merged: true` and `status: done`. The caller
gets a false success signal for a ticket that plainly still has a pull request work product to land.

`packages/shared/src/types.ts`'s `incompleteDelivery()` (VS-250) already flags VS-665's resulting
record — `merged: true` with no `mergeCommit` — as incomplete on the board, ticket detail and CLI. But
that visibility is surfaced only after the fact; the RPC itself still reports success, and nothing
ever revisits a `done` ticket to correct the record once the real merge happens later.

## What Changes

- `mergeDone` no longer completes silently for a ticket with no project when that ticket still has a
  pull-request work product to land: it throws (`merge_unverified`, retryable) instead, leaves the
  ticket in `merging`, and records a system comment — matching how every other landing failure in
  this function already behaves. A ticket with no project and no pull request (nothing to land) keeps
  completing exactly as before; this only closes the specific hole VS-665 hit.
- The daemon's periodic reconcile pass gets a new step that finds `done` tickets whose delivery
  matches the `incompleteDelivery()` signature (`merged: true`, no `mergeCommit`) and still names a
  pull request, checks that pull request against the forge, and corrects the delivery record
  (`mergeCommit`, `merged`, `method`) once the forge confirms it really did merge. A pull request the
  forge still shows as open or closed-unmerged is left untouched — still visibly incomplete, never
  silently accepted. This is the mechanism that self-heals VS-665's record once its pull request is
  actually merged, and it also catches any other ticket the same projectId-null window affected,
  without a one-off manual DB edit.
- Operationally, as part of this ticket: PR #534 is checked for mergeability, rebased if the base
  moved, and merged for real; the reconcile step above then corrects VS-665's delivery record on its
  next pass. Findings from checking other `done` tickets for the same incomplete-delivery signature
  are stated in the PR description.

## Capabilities

### Modified Capabilities

- `ticket-delivery/delivery-record`: `mergeDone` must fail loudly rather than complete when a ticket
  with no project still has a pull request to land, and a periodic sweep corrects a `done` ticket's
  delivery record once a pull request it names is confirmed merged on the forge.

## Impact

- `packages/core/src/tickets/service.ts` — `mergeDone`'s no-project branch.
- `packages/core/src/supervisor/index.ts` — a new reconcile step alongside `reconcilePullRequests`.
- Tests: `packages/core/src/tickets/tickets.test.ts` (or a new `merge-done-*.test.ts`),
  `packages/core/src/supervisor/*.test.ts`.
- Operational: PR #534 merged for real; VS-665's delivery record corrected by the new reconcile step
  once it lands; other `done` tickets checked for the same signature.
- No public HTTP/MCP shape changes: `mergeDone` already throws `OcError`s for other landing failures,
  and the reconcile pass is entirely internal.
