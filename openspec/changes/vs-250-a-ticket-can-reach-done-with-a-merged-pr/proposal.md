## Why

A ticket can finish as `done` with a pull request the forge has merged, and still have no `mergeCommit`, no `merged: true`, and no `ticket.delivery_landed` row. VS-227 is the standing example: delivery is `{ prUrl, prState: "merged" }` because reconcile (or `addWorkProduct`) wrote the PR state and some other path then set `done` — not `mergeDone`, which is the only writer of a complete delivery. The board, `ac_ticket_get`, and `conductor ticket list` all treat that ticket as an ordinary success; the gap is visible only if someone opens the raw `delivery` JSON and notices a field that is not there. VS-239 already made the upgrade announcement honest about the symptom (a release commit with no delivery record). VS-232 already closed the verification bug that produced VS-227's instance. The ticket itself is still silent, and `transition(merging → done)` is still a legal writer that recreates the shape.

## What Changes

- **A shared predicate** names an incomplete delivery: a `done` ticket whose delivery claims a merge (`prState === "merged"` or `merged === true`) but is missing `mergeDone`'s signature (`merged === true` and a non-empty `mergeCommit`). Scout, question, and no-diff task endings (null delivery, or a PR that was never claimed merged) are not incomplete.
- **Passive visibility** on every surface that already presents a finished ticket's outcome: the board/card chip, the ticket detail header, and `conductor ticket show`. The chip stops looking like a normal merge. `conductor doctor` is unchanged (host setup, not ticket data). No conductor wake, no reconcile sweep, no auto-repair of historical rows.
- **The remaining producer is closed.** `ac_ticket_transition(..., "done")` from `merging` is refused; `mergeDone` remains the only way a ticket leaves `merging` for `done`. Landing verification itself (VS-232) is untouched.
- Historical rows such as VS-227 are not rewritten. They become visible under the predicate.

## Capabilities

### New Capabilities

- `ticket-delivery/delivery-record`: what a complete PR (or local-branch) delivery contains after `mergeDone`; when a `done` ticket's delivery is incomplete; that the incompleteness is visible on the ticket's own surfaces; and that `merging → done` is written only by `mergeDone`.

### Modified Capabilities

- (none)

## Impact

- `packages/shared` — a pure `incompleteDelivery(ticket)` helper (same home as `landingBranchOf`); used by core, UI, CLI, and tests.
- `packages/core/src/tickets/guards.ts` — refuse `merging → done` via `transition()`; `mergeDone` still writes `done` directly.
- `packages/ui` — `outcomeOf` / `OutcomeChip` and the ticket-page header distinguish incomplete delivery from a normal merge.
- `packages/cli/src/commands/ticket.ts` — `ticket show` prints the delivery gap instead of omitting `delivery` entirely.
- Tests: shared helper, transition guard, UI chip, CLI show. No migration. VS-239's announcement path and VS-232's verification path are out of scope.
