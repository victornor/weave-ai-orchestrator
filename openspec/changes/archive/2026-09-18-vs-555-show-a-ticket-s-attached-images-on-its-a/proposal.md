## Why

A worker's rendered screenshots already land on disk, but a human deciding a plan, a merge or an
action sees none of them where the decision is made. `weave_ticket_attachment_put` (VS-502) stores a
file against a ticket and the ticket page shows it, yet the approval cards show nothing, so a merge
approval for a customer-facing UI change arrives with no picture of the UI — and on 2026-09-17 the
captures had been left in a scratch directory that no longer existed, so nobody approving could look
at what they were approving. The tool also refuses the one place the worker rules tell a worker to
keep captures (its own home, outside `work/`), so attaching is harder than citing a path.

## What Changes

- **Approval cards show the ticket's evidence.** A `plan_approval`, `merge_approval` or
  `action_approval` card renders the ticket's attached images inline — in Needs you, the chat pane
  and the ticket page — viewable at full size without leaving the card. Non-image attachments are not
  dropped: each shows its label, type and size with a download. A ticket with no attachments renders
  the card exactly as it does today.
- **Attaching rendered evidence is the easy path.** `weave_ticket_attachment_put` accepts a file in
  the acting worker's own home directory (outside `work/`), and its description plus the worker skill
  tell the agent to attach rendered captures to the ticket rather than cite a path.
- **State the scoping decision.** Attachments are shown ticket-scoped, newest first, each labelled
  with when it was captured — not filtered to the commit or plan revision under approval, because an
  attachment carries no revision and the cards carry no reliable commit. A capture from an older
  round reads as older rather than being hidden; the reasoning is in `design.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-v2/decision-card`: the plan/merge/action approval card shows the ticket's attached evidence
  inline, with a full-size view and non-image download rows.
- `ticket-attachments`: the attach path allowlist accepts the acting worker's own home directory, and
  the attach affordance directs agents to attach rendered evidence.

## Impact

- `packages/ui`: a shared evidence strip and full-size viewer used by `V2DecisionCard` (Needs you,
  chat) and the V1 `DecisionCard` mounted on the ticket page; `TicketDetail.attachments` already
  exists, so no new API.
- `packages/core`: ticket `putAttachment` gains the acting agent's own home as an accepted root; the
  shared outbound-chat allowlist is untouched.
- `packages/server`: the `weave_ticket_attachment_put` description changes.
- `skills/weave-ai-worker`: a line directing a worker to attach rendered evidence to its ticket.
- Tests: UI card evidence rendering (present, empty, mixed, full-size), core allowlist accept/reject,
  and the agent-prose guard.
