## Why

On 2026-09-08 the conductor closed VS-71 (Fernwood backups) by transitioning it `in_review` →
`merging` → `done`, because a `change` ticket cannot go directly to `done` and its own merge
verification could not pass — the project lands on `edge` while verification checks `main`. Entering
`in_review` had already raised a `merge_approval` decision, owned by the human. The ticket reached
`done` seconds later; the decision did not move. **It is still `open`, still owned by the human, for
a ticket that is finished and a pull request that was already merged.**

An open approval card is an instruction to the human to act. This one asks captain to approve
merging work that is already merged and closed — confusing at best, and if they act on it, the
daemon would attempt to merge an already-merged pull request. VS-140 fixed a card that goes stale
*while the human is looking at it* (superseded, answered elsewhere, expired). This is the adjacent
case the model never covered: the subject itself — the ticket — finishes, and nothing tells the
decision.

Investigation (see `design.md`) found no existing code closes a decision because its ticket finished.
`propagateTerminal()` (`packages/core/src/tickets/service.ts:207-229`) already runs every time a
ticket reaches `done` or `cancelled` — from `transition()`, from `cancel()`, and from `mergeDone()` —
but only wakes dependents and the parent; it never looks at the ticket's own decisions.

## What Changes

- A new `DecisionsService.withdrawForTicket(actor, ticketId, reason)` bulk-withdraws every still-`open`
  decision whose `ticket_id` matches, the same way the existing single-decision `withdraw()` does:
  status → `withdrawn`, the reason recorded as the answer text, a `decision.withdraw` activity entry
  per decision (auditable), and a `decision.answered` event per decision — so the live-visibility
  wiring VS-140 already built removes each card from every view without any client change.
- `propagateTerminal()` calls it once, right after a ticket becomes `done` or `cancelled`, which
  covers every path that reaches those statuses (`transition()`, `cancel()`, `mergeDone()`) from one
  place, defensively (a failure here logs and does not block the ticket reaching its terminal state,
  matching the existing defensive pattern around `supersedeForTarget` in `putDocument`).
- This applies uniformly to every decision kind, with no kind-based branching: a decision only ever
  carries a `ticketId` when it is asking something about that specific ticket's own progress
  (`plan_approval`, `merge_approval`, `retry_approval`, and a ticket-scoped `gate_finding` / `question`
  / `concern`) — once the ticket is done or cancelled, none of those have anything left to decide.
  Decisions that legitimately outlive any single ticket never carried one in the first place:
  `hire_approval` and `discard_approval` are scoped to a role, a workspace-wide `question` (the
  workers-runtime migration) and a runtime-wide login-outage `gate_finding` carry `ticketId: null` by
  design. Filtering by `ticket_id = <the finished ticket>` already excludes exactly the decisions that
  should survive, with no separate kind allowlist needed.
- A decision that already left `open` status — answered, expired, superseded, or previously withdrawn
  — is untouched: `withdrawForTicket` only ever selects rows still `status = 'open'`.

Not changing: the `in_review` → `merging` → `done` path itself. The ticket's "worth checking" question
is answered in `design.md` — the landing-branch verification gap that produced this specific case is
VS-119 (shipped) and VS-141 (its configuration, explicitly out of scope here); there is no other small,
obvious change to the transition path itself that removes the need for this cleanup.

## Capabilities

### Modified Capabilities

- `human-decisions/approval-integrity`: an open decision closes (withdrawn) the moment its ticket
  reaches `done` or `cancelled`, whatever kind of decision it is, as long as it is scoped to that
  ticket; an already-closed decision, or one not scoped to any ticket, is unaffected.

## Impact

- `packages/core/src/api.ts` — `DecisionsService` gains `withdrawForTicket(actor, ticketId, reason):
  number`.
- `packages/core/src/decisions/service.ts` — new `withdrawOpenForTicket` helper (parallel to
  `supersedeOpen`) and the public `withdrawForTicket` wrapper.
- `packages/core/src/tickets/service.ts` — `propagateTerminal()` calls
  `deps().decisions.withdrawForTicket(...)`.
- Tests: `packages/core/src/decisions/decisions.test.ts`.
