## Why

`DecisionCard.tsx`'s merge-approval card renders a **Hold** button that calls `answer('hold')`, but
a merge approval's real options are only `approve` and `changes` (`packages/core/src/tickets/service.ts`).
`decisions.answer` rejects any key the decision does not offer, so pressing Hold today throws a
`validation` error the UI surfaces as a passing toast ("Could not record that answer — unknown option
\"hold\"") while the card sits there unchanged, still offering the same broken button. The same audit
found a second, identical mismatch: the discard-approval card's **Discard** button calls
`answer('discard')`, but a `discard_approval` decision's real options are `approve`/`reject`
(`packages/core/src/roles/index.ts`) — that button has never worked either. Both are the same class
of bug: a card's buttons are hand-written literals that can drift from the options the decision they
answer actually declares, with no test catching the drift.

## What Changes

- Remove the Hold button from the merge-approval card. Dismissing/hiding a card (VS-72) already
  covers "I want to think about this before I answer" without inventing a new decision state that
  stays open, is "answered", and still needs to be actionable later — which is what a real Hold
  option would require of `decisions.answer`'s status lifecycle.
- Fix the discard-approval card's Discard button to send `approve` (its decision's real key for "go
  ahead and discard"), matching what `applyDiscardApproval` already checks for.
- Add a single canonical list of the option keys each hard-coded ("named-variant") decision card is
  allowed to send, shared between `packages/core` (where these decisions are created) and
  `packages/ui` (where the cards send them), so the two can no longer drift silently.
- Add tests that assert every hard-coded card action for `plan_approval`, `merge_approval`,
  `hire_approval` and `discard_approval` is a key that decision kind's real, produced decision
  actually offers.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `human-decisions/approval-integrity`: adds the requirement that a decision card must never offer
  an action its decision does not accept, and specifies the merge-approval and discard-approval fixes
  as the two instances this change corrects.

## Impact

- `packages/ui/src/components/DecisionCard.tsx` — remove the Hold button; fix the Discard button's key.
- `packages/shared/src/enums.ts` (or a neighboring module) — new canonical option-key map.
- `packages/core/src/tickets/service.ts`, `packages/core/src/roles/index.ts` — decision creation cites
  the canonical keys instead of free-floating literals, so core and the card can never disagree again.
- `packages/ui/src/test/components.test.tsx`, `packages/core/src/tickets/*.test.ts`,
  `packages/core/src/roles/roles.test.ts` — new coverage.
- No API, schema or migration changes. No change to what approving or requesting changes does, and no
  change to the dismiss/hide behavior from VS-72.
