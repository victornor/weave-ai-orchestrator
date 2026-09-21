## Why

VS-634 gave every weaver message a strip of chips for the tickets it references, and each chip opens
the ticket modal on desktop. The modal is the only place the ticket's live feed can be read, so
following several tickets a message is about means opening and closing the modal for each. Captain
asked (2026-09-21) for each chip to expand in place, under the message, showing the same live feed
the modal shows in a short bounded panel that can be collapsed again and closes itself when the
ticket finishes.

## What Changes

- **Each chip gains its own expand control.** A small chevron button beside the chip's status, with a
  hit target separate from the chip body, `aria-expanded`, a label naming the ticket ("Show live
  status of VS-633" / "Hide …") and keyboard reachability. The chip body still opens the ticket
  through the chat's one shared link handler, exactly as today; the chevron only toggles the panel.
- **The panel reuses the modal's feed.** Expanding a chip mounts `TicketActivityFeed` — the same
  component the ticket modal renders — directly under the chip row, inside the message block; no
  second renderer is written. Ticket references inside the feed go through the same shared link
  handler the message body uses.
- **It is short and scrolls itself.** The panel is capped at about ten text lines with its own scroll
  inside the cap, and does not collapse smaller than about six lines while it holds content. Long
  content scrolls in the panel, never in the chat.
- **It is live, cheaply.** While expanded it follows the ticket's events through the queries and
  stream the chat already has open — no new poll and no new connection — using the shared
  `useStickToBottom` follow in its contained mode: it stays at the newest line while the reader is at
  the panel's bottom and pauses when they scroll up inside it. A new line never scrolls the chat.
  The feed mounts, and subscribes to anything extra, only while its chip is expanded.
- **It collapses again, and closes itself when the ticket finishes.** The chevron collapses it;
  several chips can be expanded at once; open state is per chip in the current view only. When an
  expanded ticket reaches a terminal state (`done` or `cancelled`) *while open*, the panel collapses
  on its own with a short transition, honouring reduced motion, and the chip keeps showing the final
  status. A ticket already finished when expanded stays open until the reader closes it, and
  in-review, needs-you and blocked do not auto-collapse.
- **No layout jumps.** Expanding grows the message block by the panel height alone; the chat's
  existing follow-latest keeps a reader at the bottom at the bottom and never moves one who scrolled
  up.
- **Phone.** The same control and panel at 390 width, with a comfortable touch target and the
  message's own width.
- **Scope.** It applies wherever VS-634's strip renders — the weaver chat and the global chats. The
  modal, planner chat and worker/session transcripts are unchanged.
- Display only. No new route, no schema change, no new polling or connection, no dependency.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/dispatch-labels`: a chip's contract is broadened — besides opening its ticket, a
  chip carries an independent expand control that discloses the ticket's live feed inline, reusing
  the ticket's one feed, live through the existing queries and stream, open per chip and
  auto-collapsing on a terminal transition.
- `web-v2/chat`: the V2 Chat screen renders that inline panel under the chip row — bounded height with
  its own scroll, shared contained follow, no layout jump, phone layout and reduced-motion handling —
  wherever the strip is rendered.

## Impact

- `packages/ui/src/v2/ChatChips.tsx` — `V2DispatchChip` is split into a chip body (still the shared
  open-ticket action) and a separate chevron control; `V2TicketStrip` owns the per-chip open state and
  renders the panels through an exit-presence for the closing transition.
- `packages/ui/src/v2/ticket/TicketActivityFeed.tsx` — reused unchanged as the panel's body.
- `packages/ui/src/v2/ChatPage.tsx` — unchanged: the strip already receives `references` (ticket +
  worker) and the shared `open` handler, so the panel needs no new prop threaded through the chat.
- Tests: `packages/ui/src/test/v2ticketstrip.test.tsx` extended, and a focused
  `packages/ui/src/test/v2ticketchippanel.test.tsx` for the panel's own behaviour.
- No `docs/API.md`, no migration, no dependency change.