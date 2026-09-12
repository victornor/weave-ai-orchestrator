## Why

A `plan_approval`, `merge_approval`, or `action_approval` is born **not looked at yet**, and VS-266 only holds an approving answer once the weaver has marked it **looked at, with concerns**. So the common case — a card the weaver has not reviewed at all — is still fully approvable, and the only thing stopping a thumb from landing on an unreviewed approval is the weaver racing to say "don't approve yet". Captain asked for the approving action to be withheld until the weaver has looked, and the requirement that deliberately allowed the unseen approval ("Review is never a gate on answering") is the thing to amend.

## What Changes

- **BREAKING** (spec-level, intended): the approving answer on an `open` review-carrying decision whose review state is **not looked at yet** is refused server-side — the same distinct `revision_pending` outcome the VS-266 concern-hold already produces, naming the pending review — instead of being accepted.
- The hold stays scoped to a single still-`open` decision, reuses the VS-266 machinery (`weaverReviewStatus` + `status`, the `overrideHold`/`overrideReason` answer pair, the `decision.hold_overridden` activity + ticket comment), and lifts the moment the weaver marks the decision **looked at** (or **looked at, with concerns**, which substitutes its own hold).
- The human's deliberate override is reused unchanged for the unreviewed hold: a stated reason is required, the override is recorded and visible on the ticket, and it does not depend on the worker's or the weaver's state.
- The `system` actor answering under YOLO is exempt from the **unseen** hold only (holding it would make YOLO unable to grant the plan approvals it exists to grant); the **concerns** hold continues to apply to the system actor exactly as VS-266 wrote it.
- Card copy: the card still appears in chat and Needs you, keeps an unreviewed card's approve action out of the UI, keeps `revise`/`reject` (and a merge card's request-changes) available, and says plainly that it is waiting on the weaver's review. `weaverReviewCopy` gains an `awaitsReview` signal beside the existing `held`.
- No data migration: no new column; the hold is computed from `weaverReviewStatus` and `status`, both already on the row.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `human-decisions/conductor-review`: amends "Review is never a gate on answering" so an approving answer on an **unseen** decision is refused like one on a concern-marked decision, extends "A human can override a held approval" to cover both holds, and adds a requirement that an unreviewed card states plainly it is waiting on the weaver's review and withholds the approve action. The review-assertion, after-the-fact, supersession-lift, concerns-copy and wake-the-weaver requirements are unchanged.

## Impact

- `packages/core/src/decisions/service.ts`: the `answer()` hold condition covers `unseen` as well as `concerns`, scoped off the `system` actor for `unseen`; the refusal details name which review state is pending; the override comment wording covers both holds.
- `packages/shared/src/weaver-review.ts`: `weaverReviewCopy` exposes `awaitsReview` (unseen + open), alongside `held`.
- `packages/render/src/decision.ts` and `packages/render/src/types.ts`: the card model carries `awaitsReview`; the review body line renders the waiting-on-review sentence.
- `packages/ui/src/components/DecisionCard.tsx`: the approve action is not rendered while unreviewed; the override control is offered; the review line says why.
- `packages/ui/src/lib/decisionStaleness.ts`: the `revision_pending` copy distinguishes "not reviewed yet" from "the weaver has concerns".
- `packages/cli/src/commands/decision.ts`: `--override-hold` is accepted while `awaitsReview` as well as `held`.
- Tests: every existing test that approves an unseen plan/merge/action decision must be updated to mark it **looked** first (the new normal path) or to supply the override where it is specifically testing the approving action.
