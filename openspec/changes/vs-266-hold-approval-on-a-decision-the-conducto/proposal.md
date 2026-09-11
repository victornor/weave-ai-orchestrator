## Why

The conductor can mark a `plan_approval`, `merge_approval`, or `action_approval` **looked at, with concerns**, and the human can still answer `approve` on that same open decision in the same breath — the disabled-looking UI state is cosmetic, not enforced, and the API/CLI/channel paths never look at the mark at all. Captain has now nearly approved a card the conductor had explicitly sent back, twice, on the riskiest ticket in flight (VS-259). This proposal makes the mark load-bearing: a decision the conductor marked **concerns** refuses an approving answer everywhere, until the concern is superseded by real, subsequent work, or a human deliberately overrides the hold.

## What Changes

- `human-decisions/conductor-review`'s existing "Review is never a gate on answering" requirement is replaced: an approving answer (`approve` on `plan_approval`/`action_approval`, `approve` on `merge_approval`) on an **open** decision currently marked **looked at, with concerns** is refused by the decisions service itself — not the UI — with a distinct, identifiable error. Non-approving answers (`revise`, `reject`, `changes`) are never affected.
- The hold is scoped to that one open decision instance. It lifts on its own the moment that instance stops being the live question: **BREAKING** in the sense that a stale open decision under a concern can no longer be approved at all once superseded (already true today for `wrong_status`, now also true while merely held) — no new "supersede" mechanics are introduced, this proposal only builds on the existing correlation-key supersession `decisions.create()` already performs when a ticket cycles back through `proposed` (fresh `plan_approval`) or `in_review` (fresh `merge_approval`). The investigation in `design.md` establishes that this — not the `target.documentId`/`revision` pair — is the mechanism that actually fires for a real revision.
- A human gets an explicit, deliberate override: a distinct request shape (not the same Approve click) that records who overrode the hold, when, and why, then answers the decision as approved. Without it, a held decision has no approving path at all.
- `conductorReviewCopy` (`packages/shared/src/conductor-review.ts`) grows a signal the card can use to say plainly that approval is held pending a revision, distinct from the existing advisory line.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `human-decisions/conductor-review`: replaces "Review is never a gate on answering" with a requirement that an approving answer on an open, concern-marked decision is refused server-side, defines exactly when the hold lifts, and adds the human override path and its record-keeping. The "asserts the review" and "after the answer" requirements are unaffected — this only changes what an approving *answer* does while a concern mark stands.

## Impact

- `packages/core/src/decisions/service.ts`: `answer()` gains the hold check ahead of applying the answer's side effects; a new override input is threaded through.
- `packages/shared/src/errors.ts`: one new `ErrorCode`.
- `packages/shared/src/conductor-review.ts`: `conductorReviewCopy` (or a sibling function) exposes whether approval is currently held, for the card and the CLI to render.
- `packages/server/src/routes/decisions.ts`, `packages/cli/src/commands/decision.ts`: the answer request/response shape carries the override fields.
- `packages/ui/src/components/DecisionCard.tsx`: Approve is disabled while held, replaced by (or accompanied by) a distinct override control that collects a reason.
- No schema migration: the hold is computed from `conductorReviewStatus` plus decision `status`, both already columns on `decisions`.
