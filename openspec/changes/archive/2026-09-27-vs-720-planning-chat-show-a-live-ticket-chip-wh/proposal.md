## Why

When a planner dispatches a scout draft early, the plan tab's conversation says nothing but the
planner's own prose ("I dispatched a scout") — no identifier, no status, no way to open the ticket or
watch it run, unlike the weaver chat's ticket strip for the exact same kind of dispatch. `PlanTab.tsx`
calls the shared `chatEntries` helper with empty ticket and worker lists, so it can never resolve a
dispatch or a mentioned identifier into a chip, and the planner's dispatch tool result carries no
ticket identifier for it to even mention reliably.

## What Changes

- `PlanTab` reads real tickets and workers (the same lists `ChatPage` already fetches for the weaver
  pane) and passes them into `chatEntries`, so a dispatched scout's ticket resolves to a `Dispatch`
  exactly as a weaver-filed ticket does today.
- The plan tab's conversation renders `V2TicketStrip` under a planner message the same way the weaver
  chat does: one chip per referenced ticket, anchored to the message, carrying live status, opening
  the ticket, and expanding to the inline `TicketActivityFeed` behind its chevron. This is reuse of
  the existing `V2TicketStrip`/`V2DispatchChip` — no second chip implementation.
- The chip for a dispatch is derived from the draft→ticket link itself (via the ticket's recorded
  `createdRunId`), not from the planner's prose, so it appears even when the planner's reply never
  names the ticket.
- `weave_plan_draft_dispatch`'s tool result carries the created ticket's `ticketIdentifier`, and the
  planner's instructions (`templates/planner.AGENTS.md.tmpl`) tell it to name that identifier in its
  next `weave_plan_reply`, replacing the current "I dispatched a scout" with no reference.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `planning-sessions/v2-modal`: the plan tab's conversation no longer omits dispatch chips from the
  weaver-chat parity it otherwise renders; a dispatched scout and any ticket a planner message
  mentions now show the same live ticket strip the weaver chat shows.
- `planning-sessions/scout-dispatch`: dispatching a scout draft now returns the created ticket's
  identifier to the caller, so the planning agent can name it without a further read.

## Impact

- `packages/ui/src/v2/PlanTab.tsx`: fetch tickets/workers, wire `chatEntries`, add `renderAfterTrace`.
- `packages/server/src/tools.ts`: `weave_plan_draft_dispatch` handler and description.
- `templates/planner.AGENTS.md.tmpl`: planner instructions for naming a dispatch.
- Tests: `packages/ui/src/test/v2plantab.test.tsx`, `packages/server/test/planTools.test.ts`.
