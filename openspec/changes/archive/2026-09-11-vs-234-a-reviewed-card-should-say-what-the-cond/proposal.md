## Why

After a day of living with VS-223, captain found the clean review mark worse than useless: `Conductor looked` sends them hunting through the chat for the message where the conductor explained itself, instead of showing the conclusion beside the button — the exact treatment concerns already get, and the exact argument that justified VS-223. The mark says "I read it" (an activity) when what the human needs at the moment of decision is "here is what I concluded" and the sentence backing it.

## What Changes

- **The clean review mark now requires a note, exactly as `concerns` already does.** Marking a decision `looked` without a non-empty note is refused by the service and by the tool schema, on the open path and the after-the-fact path alike. The note is the conductor's stated reason the work is clean — the same sentence it would otherwise write into the chat — stored in the existing `conductorReviewNote` field, capped at the same 500 characters, replacing whatever a previous mark left. A note is cheap to skip; a sentence of reasoning is not, and that is what keeps the stronger wording honest (VS-223's standing instruction, exercised: if the mark still degenerates, raise the cost again — never start inferring it).
- **The copy states the outcome, not the activity.** `looked` reads as a log entry. The one copy table in `packages/shared` (`conductorReviewCopy`, cited by web, TUI and CLI) becomes: unseen — `Conductor hasn't reviewed yet`; clean — `Conductor reviewed — no concerns` (after the fact: `Conductor reviewed after you answered — no concerns`); concerns — `Conductor reviewed — has concerns` (after: `Conductor reviewed after you answered — has concerns`). The exact copy is ours to choose; "approved" was rejected on purpose — the conductor is not the approver, the human is, and claiming approval would overstate what the mark asserts. "No concerns" is precisely what was asserted, and the required note carries the reasoning.
- **The card shows the clean note beside the buttons, the way it already shows a concern.** No new component: `ConductorReviewLine` and `decisionToCard` already render whatever note the copy table returns.
- **Marks made before this change still render sensibly.** Legacy `looked` rows have no note; their cards show the conclusive line without one. No migration, no backfill — absence of a note is honest about when the mark was made.
- **Everything VS-223 established and this ticket did not touch stays untouched.** Still exactly three states; still only `plan_approval`, `merge_approval` and `action_approval` carry them; still asserted only by the conductor via `ac_decision_review`, never inferred; still never a gate — answering stays instant with no added latency; the after-the-fact distinction still works and stays worded differently; no fourth state; a ticket filed by the conductor does NOT count as reviewed (pushed back to captain; do not build unless they reaffirm).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `human-decisions/conductor-review`: a clean mark now requires a non-empty note (the stated reason), replacing any previous note; the mark's meaning changes from "read it" to "reviewed, concluded, stated why" — still asserted, still not an endorsement of correctness, still never inferred, still never a gate.
- `human-decisions/option-cards`: the exact review copy on plan, merge and action cards changes to the conclusive wording; the clean state's note renders beside the buttons like a concern's; a legacy mark without a note still renders sensibly.

## Impact

- `packages/shared/src/conductor-review.ts` — the one copy table; the clean tone now returns the note.
- `packages/core/src/decisions/service.ts` — `review()` requires and stores the note for `looked` as it does for `concerns`.
- `packages/server/src/tools.ts` — `ac_decision_review` schema: `note` required for both statuses; description updated.
- `packages/render/src/decision.ts`, `packages/ui/src/components/DecisionCard.tsx` — already generic over the copy table's note; tests updated for the new copy.
- `templates/conductor.AGENTS.md.tmpl`, `skills/agent-conductor-conductor/SKILL.md`, `skills/agent-conductor-worker/references/tools.md` — the conductor-facing guidance for the tool (both marks need the note; kept in sync across the three files).
- `docs/PLAN.md` (§6.1 decisions, §9 tool table, §15 presentation), `docs/API.md` (decision fields, MCP tool input).
- Tests: `packages/shared` copy table, `packages/core` review validation, `packages/render` body lines, `packages/ui` card rendering (chat, Needs you, ticket page, components), plus the existing no-gate and after-the-fact assertions which must keep passing.
- **Out of scope:** a fourth state; extending review to other decision kinds; any gate, queue or latency on answering; deriving the mark from activity; the conductor-filed-ticket provenance idea.
