## Why

Marking a `plan_approval`, `merge_approval`, or `action_approval` **looked at, with concerns** now correctly holds the human's approving answer (VS-266), but nothing tells the weaver when the worker has addressed the concern. The fix arrives as an ordinary ticket comment that matches none of the wakes the weaver receives today, so the held card sits unattended and the weaver's own objection becomes the delay. On 2026-09-11 this happened twice inside ninety minutes (VS-271, VS-273), each gating a daemon upgrade the human was waiting on; both gaps closed only because the human asked what happened.

## What Changes

- When an agent that is not the weaver comments on a ticket carrying at least one **open** decision marked **looked at, with concerns**, the daemon wakes the weaver once for that comment. The wake names the ticket and says the held review was answered, and its payload carries the decision id.
- A worker's `status` comment and its prose reply both count — a worker often reports the fix in a status line, and neither is reliably distinguishable from a fix report.
- The wake is strictly a notification. It does **not** clear, downgrade, or otherwise move `weaverReviewStatus`; resolving the concern stays the weaver's judgement, asserted only through `ac_decision_review`.
- Existing comment wake routing is untouched: a human's reply still relaunches the worker, and still wakes the weaver only through the no-role path.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `human-decisions/conductor-review`: adds a requirement that answering a held review — i.e. any non-weaver agent comment on a ticket with an open concern-marked approval — wakes the weaver, and pins the cases that must not.

## Impact

- `packages/core/src/tickets/service.ts`: `comment()` gains the narrow check and a single `wake()` call beside the existing human-comment routing. No schema change and no new wake source — the weaver sees an ordinary `ticket_comment` whose reason and payload name the held decision.
- `packages/core/src/tickets/tickets.test.ts`: new tests for the presence, the absence, the weaver-author exclusion, and the looked/answered exclusions, plus regression coverage that human-comment routing is unchanged.
- No changes to `decisions/service.ts`; the VS-266 hold at `:411` is untouched.
