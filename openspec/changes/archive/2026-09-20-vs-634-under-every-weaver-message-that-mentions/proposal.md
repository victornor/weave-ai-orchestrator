## Why

Today a weaver reply carries a ticket chip only when that turn *filed* and *dispatched* a ticket
(`V2DispatchChip`, anchored by `createdRunId`). A reply that merely mentions existing tickets —
"I moved VS-633 to review and re-queued VS-621" — shows nothing, so the human has to hunt the
tickets down, and the one live row below the conversation is the only place a running worker is
visible. Captain asked (2026-09-20) for every weaver message that references tickets to carry its
own small strip showing each ticket, its role/worker and its **current** status, clickable to open
the ticket in the same modal a clickable identifier already opens.

## What Changes

- **Every weaver message that references tickets gets its own strip underneath.** A reference is any
  ticket identifier in the message body (the workspace `PREFIX-n` pattern, reusing the VS-623
  linkifier) plus any dispatch the turn recorded. References are de-duplicated by ticket, kept in
  order of first mention, resolved against the workspace's tickets, and silently skipped when they do
  not resolve.
- **Each chip shows the identifier, the acting name and the live status.** The acting name is the
  worker's name (which carries its role, e.g. "Platform Engineer #552") once a worker exists, else
  the ticket's title; the status is the existing status glyph and hue, and changes from working to in
  review to merged as the ticket moves, through the ticket and worker queries the chat already
  refreshes on ticket/worker events — no new polling and no new connection.
- **Clicking a chip opens the ticket modal on desktop and navigates on phone**, through the same
  `useTicketLink` handler a clickable identifier in the text already uses. No second handler.
- **The strip is compact and never crowds a message.** One wrapped row; at most six chips, then a
  "+N more" chip that expands the rest in place. A ticket mentioned several times appears once.
- **The bottom row is kept for genuinely unaccounted workers only.** A live worker whose ticket has a
  chip under any message in the thread no longer also appears in the row below the conversation.
- **History behaves like new messages.** Older weaver messages show their strips with the tickets'
  current status, not the status at the time of the message; a ticket that no longer exists is
  skipped.
- **The strip stays part of the message block.** Follow-latest and jump-to-latest keep working, a chip
  appearing or changing under the newest message does not pull a reader who has scrolled up back to
  the bottom, and no empty strip reserves height when a message has no chips.
- **Every surface that renders weaver messages through the shared conversation component gets it** —
  the weaver chat and the global chats (which render `V2ChatPage` per pane). Worker and planner
  transcripts are unchanged.
- Display only. No new API route, no schema change, no new polling or connection, no dependency.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/dispatch-labels`: a weaver message's account of the tickets it references is
  broadened from "dispatches the turn filed" to a per-message strip of every ticket the message
  references, with the caps, de-duplication, ordering and live-status rules; the region below the
  conversation is restated as the place for work no message chip accounts for.
- `web-v2/chat`: the V2 Chat screen renders that strip under weaver messages using the same click
  handler its inline ticket tags use (modal on desktop, navigation on phone), in the weaver chat and
  the global chats, with the message-follow and no-layout-jump guarantees.

## Impact

- `packages/ui/src/lib/dispatch.ts` — the chat view model: entry-level ticket references parsed from
  the message body and merged with the anchored dispatches, and `unattributed` narrowed to workers
  whose ticket no message chipped. New pure helpers, golden-testable.
- `packages/ui/src/v2/ChatChips.tsx` — the strip: a `V2TicketStrip` composed of the existing chip plus
  the "+N more" expansion.
- `packages/ui/src/v2/ChatPage.tsx` — pass the resolved tickets/workers and the shared `openTicket`
  into the strip through `renderAfterTrace`; keep `footer` for the narrowed `unattributed` row.
- `packages/ui/src/v2/ChatConversation.tsx` — unchanged API, possibly a doc-comment update; the strip
  stays the `renderAfterTrace` render prop so the planner chat (which passes none) is untouched.
- Tests: `packages/ui/src/test/dispatch.test.tsx` (references, de-dupe, order, unresolved, bottom-row
  rule), a new strip test (`packages/ui/src/test/v2ticketstrip.test.tsx`) for the cap/expand, click
  handler and live status update, and `v2chat.test.tsx` for history/current status.
- No `docs/API.md`, no migration, no dependency change.
