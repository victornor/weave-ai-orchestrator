## Context

See proposal.md — Why. The layout chain above the worker page is already height-bounded end to end:

- `V2Root` (`.v2-root`) is `flex h-[100dvh] min-h-0 flex-col overflow-hidden`, so the document is never
  meant to scroll.
- `V2Shell` is `flex min-h-0 flex-1 overflow-hidden`; its main column and the keyed route section are
  `flex min-h-0 flex-1 flex-col`.
- `V2Page` renders the screen frame plus a body that is either the **scroll** variant (`min-h-0 flex-1
  overflow-y-auto`, the default) or the **fill** variant (`flex min-h-0 flex-1 flex-col
  overflow-hidden`, `scroll={false}`).

`V2WorkerPage` renders `V2Page` with the default (scroll) body. `WorkerBody` is a `flex min-h-0 flex-1
flex-col` whose rows are all `flex-none` except the transcript region at its line ~366
(`min-h-0 flex-1 overflow-y-auto`). So there are two nested scrollers — the page body and the
transcript region — and the outer one scrolls the header, tabs, error bands and handover band out of
view. The persistent session's transcript (`SessionThreadFeed` → `SessionTurn` → `Transcript`) is
deliberately not a scroller of its own (VS-618), so the inner region is the intended single scroller.

The weaver chat (`ChatPage` → `ChatConversation`) is the reference: a bounded column whose scroller is
`data-v2-chat-scroll`, driven by `useStickToBottom(..., { exact: true })` with a
`ScrollToBottomButton` when the reader scrolls up. Its scroller is an element, not the document;
`useStickToBottom` already listens to the element's `scroll`, handles the wheel/touch/scroll-key
gesture classification, and re-pins on `ResizeObserver`/`visualViewport` changes (the on-screen
keyboard).

`V2Page scroll={false}` is the established swallow for a screen that owns its own scroller: Live
(`LivePage.tsx:179`), the plugin iframe page (`PluginPage.tsx:113`) and Knowledge's fill tabs
(`KnowledgeFrame.tsx:106`) already use it.

The ticket modal has the same cause one level down. `TicketModal` renders one `flex flex-col gap-3`
stack into `Sheet`'s body, and `Sheet`'s body is itself the panel's single scroller:
`<div className="ac-scroll max-h-[calc(var(--ac-app-h)*0.7)] p-4">{children}</div>` (Sheet.tsx:162).
So the identifier row, title, worker line, `LiveActivityLine` and `TicketActivityFeed` all scroll as
one block. `TicketActivityFeed` renders comments and `RunTurn`s, and a `RunTurn`'s open transcript is
a `RunTranscript` with its own bounded `role="log"` box. `Sheet` is shared with two settings sheets
(remove/move project) that pass short prose and rely on the default scrolling body.

## Goals / Non-Goals

**Goals**

- The worker page header is pinned at the top and the composer at the bottom; only the tab body
  scrolls; the document never scrolls, at any viewport including the phone keyboard.
- The persistent session's conversation follows the newest turn while at the bottom, pauses when the
  reader scrolls up, and offers a jump-to-latest control.
- The ticket modal's identity header is pinned and only its activity feed scrolls, with no scroll
  chaining to the page behind, a stable size from loading to loaded, focus in and out, and the same
  follow/pause rule.
- One scroll container on each surface; no per-turn scroller.
- Reuse the existing follow hook and jump control; no new renderer.

**Non-Goals**

- Changing the weaver chat, the planner chat, or any other V2 page's scroll model.
- Changing the shared `WorkerFeed`/`RunTranscript` contract (each keeps its own bounded self-scroller).
- Rebuilding the ticket page's own activity feed; the modal reuses it, only its container changes.
- Changing the settings sheets that share `Sheet` (they keep the default scrolling body).
- Making the transcript virtualised for very long histories.
- An API, database, dependency or route change.

## Decisions

### D1. Bound the frame at the cause: `V2Page scroll={false}`

`V2WorkerPage` passes `scroll={false}`, turning the page body into the fill variant
(`flex min-h-0 flex-1 flex-col overflow-hidden`). The frame is then bounded from `.v2-root` down to the
transcript region, and the document cannot scroll. No style is added above the page, and no header
copy or `position: fixed` is introduced: the header is pinned because it is a `flex-none` row of a
bounded column.

- **Alternative considered:** leave `V2Page` scrolling and make the header `position: fixed`/`sticky`.
  Rejected — that adds a second, positioned header and still leaves the page body scrolling behind it,
  exactly what the ticket forbids.
- **Alternative considered:** change `V2Page`'s default to `scroll={false}`. Rejected — most screens
  are long documents that should scroll as one page; the fill variant is opt-in for the screens that
  own a scroller, which this page now is.

### D2. The transcript region is the single scroller, and the session conversation owns it

The `WorkerBody` transcript region stays `min-h-0 flex-1 overflow-y-auto` and becomes the only
scrolling region of the page. The session branch moves its scroll container to a component that owns
both the conversation rows and the scroller — the session feed becomes a `relative flex min-h-0 flex-1
flex-col` wrapper with a `useStickToBottom(..., { exact: true })` scroller
(`data-v2-session-scroll`) and a `ScrollToBottomButton` when `!stick.atBottom`. `exact: true` is the
same mode the weaver chat uses: the sentinel sits inside the scroller's bottom padding, so the hook
measures the scroller's own end and its rAF follow keeps up with a streaming turn.

The signal the hook watches is the conversation's row count plus its live-output size — the same shape
the weaver chat passes (`[rows, liveEvents.length]`) — computed where the rows are built. The dead
`bottom` ref in `WorkerBody` (declared, rendered, never scrolled to) is removed; the scroller's own
bottom sentinel replaces it.

- **Alternative considered:** attach the follow to the shared transcript region in `WorkerBody` and
  gate it on the active tab. Rejected — the same region renders the Brief tab, which must open at its
  top, and a ticket-run worker's `WorkerFeed`, which already follows itself; a per-branch scroller
  keeps each surface's behaviour its own.
- **Alternative considered:** extend `RunTranscript` with a `scroll=false` mode. Rejected — VS-618
  already composed its pieces for exactly this reason; the session conversation is not a bounded box.

### D3. The ticket-run worker page shares the pinned header; its feed keeps its own box

The route and component are shared, so bounding `V2WorkerPage` pins the header for a ticket-run worker
too. That worker's transcript is the shared `WorkerFeed`, which is bounded and scrolls itself
(`RunTranscript`'s `role="log"` box) inside the transcript region; with the page no longer scrolling,
the page document is fixed and the feed behaves exactly as it does on every other surface that embeds
it. The Brief tab scrolls within the transcript region, header pinned. This is the answer scope item 4
asks for: both postures pin; neither is a long document page that must scroll as a whole.

### D4. Follow is element-scoped, and the keyboard is already handled

`useStickToBottom` reads the transcript element's own `scrollTop`/`scrollHeight`/`clientHeight`, never
`window` or `document`, so moving from page scroll to element scroll cannot strand it. It re-pins on
`ResizeObserver` changes to the scroller and its content and on `window.visualViewport` resize, which
is how the on-screen keyboard is handled without any `vh`/`dvh` arithmetic in the component; the shell
already sizes from `--ac-app-h`/`100dvh`. No `window`-scroll listener is added or moved because the
surface never had one.

### D5. The regression test asserts the bounded root, not just the inner scroller

The acceptance test renders `V2WorkerPage` (not `WorkerBody` in isolation, which cannot see `V2Page`)
and asserts: `[data-v2-page-body]` is the **fill** variant (`overflow-hidden`, not `overflow-y-auto`);
the header is not inside the transcript scroll container; and the page root contains exactly one
`overflow-y-auto` element. On the old layout the page body is the scroll variant, so the test fails.

- **Alternative considered:** assert `WorkerBody` alone. Rejected — the cause lives in `V2Page`; it
  would pass on the broken layout and prove nothing.

### D6. `Sheet` gets an opt-in non-scrolling panel, not a second dialog for the modal

The cause of the modal's behaviour is `Sheet`'s body: it is the panel's only scroller and it holds the
whole children block. So the fix is at the shared level, opt-in so the settings sheets keep today's
behaviour:

- `Sheet` gains `bodyScroll?: boolean` (default `true`).
- When `false`: the panel becomes `flex max-h-[calc(var(--ac-app-h)*0.8)] flex-col` and the body
  becomes `flex min-h-0 flex-1 flex-col overflow-hidden p-4` instead of `ac-scroll max-h-…`. The
  caller then owns the scroller inside a bounded, non-scrolling body, and the panel's own header
  (`title`) and `footer` stay pinned with it.
- When `true` (settings sheets): byte-for-byte today's path.

`TicketModal` then lays out a `flex min-h-0 flex-col` column: the identity block
(identifier row, title, worker line, `LiveActivityLine`) `flex-none`, and the feed region
`relative flex min-h-0 flex-1 flex-col` with the shared follow scroller.

- **Alternative considered:** build the modal on `Drawer` or a new dialog component. Rejected —
  `Sheet` already owns the portal, theme mirror, focus trap, Escape/backdrop dismiss and (on phones)
  the bottom-sheet shape; duplicating those is a regression risk for no gain.
- **Alternative considered:** make the modal render its own scroller inside `Sheet`'s existing
  scrolling body. Rejected — the body would still scroll the pinned block and the two scrollers would
  chain.

### D7. The modal's feed is the single scroller, driven by the shared follow

The feed region's scroller (`data-ticket-modal-scroll`, `ac-scroll` so it already carries
`overscroll-behavior: contain`) wraps `TicketActivityFeed` and its bottom sentinel, and is driven by
`useStickToBottom([feedLength, liveOutput], { exact: true })` — the same hook and mode as the weaver
chat and the session conversation — with a `ScrollToBottomButton` when `!stick.atBottom`. The feed
length is known where the feed is built; `TicketActivityFeed` takes the scroller as its container so a
`RunTurn`'s nested `RunTranscript` box stays a box (unchanged) rather than becoming a second page
scroller.

- **Alternative considered:** let the live `RunTranscript` be the thing that follows. Rejected — the
  surface the human reads is the feed (comments interleaved with turns); the ticket's acceptance names
  the feed, and the whole-feed follow also covers a comment arriving with no run.
- **Alternative considered:** rely on `RunTranscript`'s own `role="log"` follow and give the feed
  none. Rejected — that would leave the modal's feed itself not following, and would make the modal's
  behaviour differ from the chat and the session page.

### D8. No scroll chaining: bound the modal, contain the feed

`useDismiss` already sets `document.body.style.overflow = 'hidden'` while a sheet is open, so the page
behind cannot scroll; the backdrop is a non-scrolling `absolute inset-0` element. The feed scroller
keeps `overscroll-behavior: contain` (via `ac-scroll`), so a wheel/touch at the feed's end does not
chain to any ancestor. The panel is bounded by `max-h` in `--ac-app-h` units — the same
keyboard-aware unit the shell uses — so it never exceeds the visible area at phone width.

### D9. Stable size: a modest floor, a bounded ceiling, skeleton inside the feed

The panel sizes to its content (so a short feed is not a tall empty box) with a `max-h` ceiling and a
modest `min-h` floor on the feed region (design floor `min-h-[20rem]`). The loading state renders its
`SkeletonRows` inside that same feed region, so loading and loaded share the region's size and the
panel does not jump when the detail and feed arrive. The pinned block is `flex-none`; a long title
wraps within it and the panel's `max-h` caps the whole column, with the feed keeping its floor. If a
title is long enough to threaten the floor, the title block is what yields (its own `overflow-hidden`
/ clamp) rather than the feed losing its scroller.

- **Alternative considered:** a fixed panel height (`h-[70dvh]`). Rejected — a fixed height with a
  `flex-1` feed is exactly the "huge empty box" captain calls out for a one-comment ticket.

### D10. Focus in and out

`Sheet` already moves focus into the dialog on open (`[data-autofocus]`, else the panel). This change
adds focus restoration: remember the element that was focused when the sheet opened and refocus it on
close, so closing the modal returns the keyboard to the ticket tag that opened it instead of dropping
to `document.body`. Settings sheets inherit this as an improvement and are not otherwise touched.
`TicketModal` marks the utility that should receive focus (the close control, so the dialog is
immediately dismissible) as `data-autofocus`.

## Risks / Trade-offs

- **The Brief tab shares the region with the transcript.** → The brief is short; it scrolls normally
  and the header stays pinned. A future change may give it its own frame, but it is not a requirement
  here.
- **A long ticket-run feed inside a bounded page.** → The feed keeps its own max-height box, so it
  does not grow the page; the page cannot scroll regardless.
- **The follow attaches where rows are built.** → The wrapper must own the row query so its signal
  reflects real content; the queries are the shared cached ones (`useThreadMessages`, `useRuns`,
  `useRunEventStream`), so this is a composition change, not a new request.
- **Nested scrollers on the ticket-run page (region + feed).** → Pre-existing and unchanged; the feed
  is a bounded box everywhere it appears. The session page — the ticket's target — has exactly one.
- **The modal's feed wraps a feed that contains bounded transcript boxes.** → Those boxes are the
  ticket page's own components and keep their `max-h`, so the feed still scrolls as a whole; the
  modal adds no scroller of its own beyond the feed. This mirrors the ticket page, so the two surfaces
  cannot diverge.
- **A shared `Sheet` change could reach the settings sheets.** → The new layout is opt-in
  (`bodyScroll={false}`, default `true`), and focus restoration only adds behaviour they lacked. The
  settings sheets are exercised by their existing tests and by a smoke render in the added tests.
- **A `min-h` floor on the feed.** → Chosen modest (`20rem`) so a one-comment ticket is a compact
  card, not a tall empty panel; the ceiling is what grows a long feed before it scrolls.

## Migration Plan

No data migration, no backfill, no route change. After the daemon is upgraded, the worker page renders
bounded; a previously open page picks the new layout on reload.

## Open Questions

None.