## Why

Two surfaces that hold a live conversation scroll the whole document instead of only their content,
so the controls a reader needs stay put by accident, not by design.

On a persistent session page (`/w/<workspace>/workers/<workerId>`) the whole document scrolls, so the
worker's header — status, project/ticket metadata and the Resume / Session / Option / Compact /
Relaunch / Cancel controls — scrolls away as the conversation grows. Captain, 2026-09-20: "the header
needs to be anchored to the top, only the chat should be scrolling, similar to how the weaver chat
works."

The ticket modal (`packages/ui/src/v2/ticket/TicketModal.tsx`) has the same shape and captain added it
to this ticket: "It needs to scroll the live view, not the entire page inside of the TicketModal."
Its whole body is one `flex-col` stack inside `Sheet`'s single scrolling region, so the identifier
row, title, worker line and live activity line scroll away with the activity feed, and the feed does
not follow a live turn.

Both are structural: the fix is to bound the frame and leave exactly one scrolling region, not to add
a second fixed-position header.

## What Changes

- **The worker page frame is bounded, and the document no longer scrolls.** `V2WorkerPage` renders
  `V2Page` non-scrolling (`scroll={false}`), so the page body becomes the
  `flex min-h-0 flex-1 flex-col overflow-hidden` fill variant. The frame is height-bounded from
  `.v2-root` (`h-[100dvh] overflow-hidden`) down through the shell and the route section, at every
  viewport.
- **The worker header, error bands, tabs, handover band and composer are pinned** — all `flex-none`
  rows — and exactly one region scrolls: the transcript region (`min-h-0 flex-1 overflow-y-auto`).
- **The persistent session's conversation follows the newest turn and pauses when the reader scrolls
  up**, using the shared `useStickToBottom` hook on the transcript element (the same follow the
  weaver chat uses), with a `ScrollToBottomButton` when the reader has scrolled away. The dead
  `bottom` ref in `WorkerBody` — declared and rendered but never scrolled to — is replaced by it.
- **The ordinary ticket-run worker page shares the fix**: it is the same component and route, so its
  header is pinned too. Its brief tab and its shared `WorkerFeed` scroll inside the same bounded
  transcript region; the feed keeps its own bounded self-scroller, as it has everywhere else.
- **The ticket modal is a bounded column with a pinned identity header and one scrolling feed.**
  `Sheet` gains an opt-in layout for a caller that owns its own scroller: a height-bounded panel whose
  body does not scroll, leaving the default (settings sheets) untouched. The modal pins the identifier
  row, title, worker line and live activity line, and scrolls only `TicketActivityFeed`.
- **The modal's feed follows a live turn and pauses on scroll-up**, reusing the shared element-scoped
  follow rather than adding a third copy; it contains its own overscroll so it never chains to the
  page behind the modal.
- **Stable and polished:** the modal holds its size from loading to loaded (the skeleton fills the
  feed area), a short feed does not leave a tall empty box, long titles wrap inside the pinned header,
  and focus lands inside the dialog on open and returns to the opening control on close.
- **No fixed-position or duplicated header** on either surface; the header is pinned by being a
  `flex-none` row of a bounded column.
- No API, database, dependency or route change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `persistent-sessions`: a session's conversation surface is bounded — a pinned header above a single
  scrolling transcript region — instead of the page scrolling as one document; it follows the newest
  turn while the reader is at the bottom and pauses when they scroll up.
- `web-v2/worker-page`: the worker page fills the V2 frame with a pinned header and composer, and its
  tab body is the only scrolling region, for both a persistent session and a ticket-run worker.
- `web-v2/chat`: the ticket modal opened over a chat is a bounded, stable panel whose identity header
  is pinned and whose activity feed is the only scrolling region; it does not chain scroll to the page
  behind it and its feed follows a live turn until the reader scrolls up.

## Impact

- `packages/ui/src/v2/WorkerPage.tsx` — `V2WorkerPage` passes `scroll={false}` to `V2Page`; the
  transcript region gets the shared `useStickToBottom` follow and a jump-to-latest control; the
  session row list moves behind the transcript's own scroller.
- `packages/ui/src/components/Sheet.tsx` — an opt-in non-scrolling, height-bounded panel layout
  (`bodyScroll={false}`) and focus restoration on close; the default path used by the settings sheets
  is unchanged.
- `packages/ui/src/v2/ticket/TicketModal.tsx` — pinned header block, a bounded feed region driven by
  the shared follow hook, and a stable sizing floor/ceiling.
- Tests: `packages/ui/src/test/v2worker.test.tsx` (bounded-root regression test plus follow coverage),
  `packages/ui/src/test/ticketModal.test.tsx` (pinned-header/one-scroller regression test, followed
  feed, focus restore), `packages/ui/src/test/v2ticket.test.tsx` and `packages/ui/src/test/v2feed.test.tsx`
  for the shared feed and ticket page; `packages/ui/src/test/stickToBottom.test.tsx` unchanged.
- No `docs/API.md`, no migration, no dependency, no new component outside the files above.