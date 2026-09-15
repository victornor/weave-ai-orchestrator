## Why

On 2026-09-14/15, VOFM-77's merge approval (`01M2H4C2P0D8G2EPGDA5MH5KEA`) sat unseen for three hours.
The weaver was woken at creation, but its run never called `weave_decision_review` — its summary said
"marked looked" while the `activity` table recorded no `decision.review` for it. Because of VS-411 an
`unseen` approval is excluded from the Needs-you count and its approving answer is refused, and
nothing re-woke the weaver, so every later digest the weaver read treated the ticket as already
reviewed and waiting on captain. At 02:37Z captain reported the ticket "silently dropped". One card
can therefore stall indefinitely with no signal to either side.

## What Changes

- **Re-wake the weaver while an approval stays unseen.** When a human-owned `plan_approval`,
  `merge_approval` or `action_approval` stays `unseen` for more than 10 minutes, the supervisor wakes
  the workspace's weaver, naming the decision, its ticket and how long it has waited. It repeats with
  backoff (about 10, then 30, then 60 minutes between wakes) until the card is reviewed or closed.
  The wake is idempotent per decision and per backoff stage, and never stacks duplicates; it respects
  the daemon's run limit.
- **List unreviewed approvals as explicit action items.** Every digest the supervisor builds carries
  the open approvals still `unseen` as a distinct "not reviewed" list, named in the wake reason; and
  the weaver's per-turn "Open decisions" list marks an unreviewed review-carrying card so "I still
  owe this a review" cannot read as ordinary open work.
- **Show captain the card is waiting on the weaver.** An `unseen` approval keeps its card on Needs you
  and on the ticket page, reads as waiting on the weaver's review, and does not look like a plain
  approvable card. The ticket page for an `in_review` ticket with such a card shows that waiting
  state in its header, not only "In review". VS-411's badge rule is kept: the actionable Needs-you
  count still excludes an unreviewed card, and starts counting it once the weaver marks it.
- **Tool truthfulness (change item 4) is deliberately not taken.** The design argues why a
  self-reported "decisions I reviewed" list is the wrong signal and why items 1–3 already make the
  outcome impossible to mistake; see `design.md`, Decision 4.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `human-decisions/conductor-review`: adds that a review-carrying decision left **not looked at yet**
  and `open` re-wakes the weaver on a backoff until it is reviewed or closed, and that the reminder
  names the decision, its ticket and its age without stacking duplicates.
- `worker-supervision/conductor-digest`: adds that the digest carries the open approvals still
  awaiting review as an explicit, bounded "not reviewed" list, named in its wake reason.
- `agent-prompts/weaver-open-decisions`: adds that the weaver's per-turn open-decisions list marks a
  review-carrying card that is still **not looked at yet**.
- `web-v2/ticket-page`: adds that a ticket waiting on an unreviewed approval shows the waiting-on-review
  state rather than only its ticket status.
- `web-v2/needs-you`: adds that an approval awaiting the weaver's review stays listed and reads as
  waiting, while the actionable count still excludes it (VS-411) until it is reviewed.

## Impact

- `packages/core/src/supervisor/index.ts` — a new `reviewReminderScan()` pass on the liveness cadence,
  its threshold/backoff constants, and the `pendingReview` list added to `conductorDigest()`.
- `packages/core/src/prompts/index.ts` — the weaver's "Open decisions" lines mark an unreviewed
  review-carrying decision.
- `packages/core/src/decisions/service.ts` — no behaviour change; the reminder reads the same
  `weaver_review_status` the review write owns. (Item 4 dropped; see design.)
- `packages/ui/src/v2/ticket/Ticket.tsx` — the header shows waiting-on-review when the ticket's live
  approval is unreviewed; a small derivation beside the existing decision lookup.
- `packages/ui/src/v2/needsCount.ts` — unchanged; the change's tests pin VS-411's rule.
- `docs/API.md` — no route change; the decisions list already carries `weaverReviewStatus`.
- Tests: `packages/core/src/supervisor/supervisor.test.ts` (reminder backoff/idempotency, digest
  list), `packages/core/src/prompts/*.test.ts`, `packages/ui/src/test/v2ticket.test.tsx`,
  `packages/ui/src/test/v2needs.test.tsx`, `packages/ui/src/test/v2needsCount.test.ts`, plus one
  core integration test reproducing the VOFM-77 shape end to end.
