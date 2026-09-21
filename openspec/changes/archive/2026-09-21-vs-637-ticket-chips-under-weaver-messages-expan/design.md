## Context

See proposal.md — Why. Relevant current state (verified against the tree at `67474b5`):

- `packages/ui/src/v2/ChatChips.tsx` holds `V2DispatchChip` (one `<button>`, `.v2-tag` recipe:
  status glyph, identifier, acting name, status word) and `V2TicketStrip`, which renders
  `entry.references` (a `Dispatch[]`, each `{ ticket, worker, status }`) as a wrapped row of those
  chips plus a `+N more` chip. `ChatPage.renderAfterTrace` renders the strip with `projectIds` and
  `openTicket` — the `useTicketLink()` handler (modal on desktop, navigation on phone) — so the strip
  already has the ticket and the shared link handler.
- `packages/ui/src/v2/ticket/TicketActivityFeed.tsx` is the ticket's one live feed: it loads
  `useTicketComments(ticket.id)` and `useTicketRuns(ticket.id)`, interleaves comments and `RunTurn`s,
  and each `RunTurn` opens `useRunEventStream(run.id)` only for the live run. `TicketModal.tsx`
  mounts it inside a bounded scroller with `useStickToBottom(..., { exact: true })`.
- `packages/ui/src/lib/stickToBottom.ts`'s `useStickToBottom` has a `contained` mode for a list nested
  in another scrolling one: it moves its own `scrollTop` and never `scrollIntoView`s, so it cannot
  drag the page/chat it sits in. Its `pause`/follow classification already distinguishes a human
  scroll from a reflow.
- `packages/ui/src/v2/motion.ts`'s `useExitPresence(items, keyOf, exitMs)` holds removed items for
  `exitMs` with an `exiting` flag, for an exit animation (`.v2-anim-exit`); under reduced motion
  `index.css` zeroes the animation durations, but the JS hold would still delay unmount.
- `packages/ui/src/lib/streamReveal.ts` exports `usePrefersReducedMotion()`.
- `TICKET_STATUSES` / `TERMINAL_TICKET_STATUSES` (`done`, `cancelled`) are in
  `packages/shared/src/enums.ts`. `dispatchStatus` prefers a live worker's status, so a worker that
  finished while the ticket is still `in_review` reads `done` on the chip — the ticket's own status is
  the right signal for auto-collapse.

## Goals / Non-Goals

**Goals:**

- A separate, accessible expand control per chip that toggles a bounded inline panel rendering the
  ticket's one live feed, in the message block, in the weaver chat and global chats.
- Live and cheap: the feed mounts and subscribes only while its chip is expanded; liveness comes from
  the chat's existing queries and stream.
- Auto-collapse on a terminal transition while open, with a calm transition that reduced motion skips.
- No layout jump: the block grows by the panel only, the panel follows in contained mode, the chat's
  own follow is untouched.

**Non-Goals:**

- No change to the ticket modal, the planner chat, worker/session transcripts, or the view model
  (`lib/dispatch.ts`).
- No new route, schema, poll, connection, dependency or persisted state.
- No second activity-feed renderer, chip recipe, link handler or follow implementation.

## Decisions

### D1. One tag, two hit targets: chip body and chevron

`V2DispatchChip` keeps `data-v2-dispatch-chip` and its `aria-label` on the **body button** (so the
existing strip tests and the shared open-ticket action are unchanged) and gains an optional
`onToggle`/`expanded` pair. When `onToggle` is passed, the chip renders as a `<span className="v2-tag"
data-v2-ticket-chip>` containing the body button (transparent, content only) and a sibling chevron
`<button data-v2-chip-expand aria-expanded aria-controls aria-label>`. Two sibling buttons in one
container give the chevron its own hit target without nesting a button in a button. The chevron is a
Lucide `ChevronDown` (already available via `lucide-react`), rotated by CSS when expanded, with a
touch-sized padded box (min ~28px square) and no layout shift between states.

Alternative — keep the single button and treat a click as expand — rejected: the ticket requires the
body still opens the modal and the chevron is a separate control.

### D2. The strip owns open state; closing goes through the presence hook

`V2TicketStrip` holds `openIds: string[]`. The chevron adds/removes its ticket id (no persistence).
The panels render through `useExitPresence(openIds, (id) => id, reduced ? 0 : 180)`: a removed id is
held for the exit animation then dropped. Under reduced motion the exiting entries are filtered out of
the render, so the feed unmounts immediately rather than waiting a JS tick; the class is still applied
for the non-reduced case. `useId` gives each panel a stable id for `aria-controls`.

### D3. The panel is a thin wrapper around the modal's feed

A `TicketChipPanel` in `ChatChips.tsx` renders, under the chip row:

- the same `TicketActivityFeed` with `ticket`, `workerName = worker?.name ?? null` and
  `onTicket = open`;
- a bounded scroller around it.

`TicketActivityFeed` itself renders `SkeletonRows` while loading; the panel adds nothing that would
become a second feed. No change to `TicketActivityFeed.tsx`.

### D4. Liveness and the follow, without a second scroller problem

The panel calls `useTicketComments(ticket.id)` and `useTicketRuns(ticket.id)` *for the follow signal
only* — the same query keys `TicketActivityFeed` mounts under it, so they are cache hits, exactly the
pattern `TicketModal` uses (TicketModal.tsx:112). The signal is
`[ticket.id, comments.data?.length ?? 0, runs.data?.length ?? 0]`, `ready` is `!isLoading` on both, and
the follow is `useStickToBottom(signal, { contained: true, ready })`. `contained` makes the follow
write its own `scrollTop` and never `scrollIntoView`, so a new line cannot move the chat; the hook's
human-scroll classification pauses it when the reader scrolls up inside the panel. The chat's own
`useStickToBottom` is untouched: a reader at the bottom is re-pinned by its `ResizeObserver` as the
message block grows, and a reader who scrolled up is not moved.

### D5. Auto-collapse is driven by the ticket's own status

An id is *armed* when it is expanded while the ticket is not terminal. `V2TicketStrip` watches the
live `references` (the chat's `useTickets` query is invalidated on `ticket.*` events): an armed id
whose ticket is now in `TERMINAL_TICKET_STATUSES` is removed from `openIds`, so `useExitPresence`
plays the closing transition. Using the ticket status rather than `dispatchStatus` is deliberate: a
worker that finished on a ticket still `in_review` (or `blocked`) must not close the panel. An id
expanded when already terminal is never armed and stays until closed. The armed set is a ref, not
state, since it only gates the auto-close decision.

### D6. Height in line-height units, verified structurally

The scroller gets `max-h-[10lh]` (CSS `lh` is the element's line-height, so the cap is literally in
lines) plus `overflow-y-auto`, `text-meta leading-relaxed`, and `v2-card` edge styling to read as a
panel; a shorter feed is content height. jsdom cannot measure geometry, so the unit test asserts the
structure (the scroller exists, is `overflow-y-auto`, and carries the cap class) and the lazy-mount/
`aria`/collapse behaviour; the actual render is verified in the browser evidence step. This follows
the project rule that a harness limit must not shrink the behaviour.

### D7. No `ChatPage` change

The strip already receives `references` (each carrying `ticket` and `worker`) and `open`; the panel
needs nothing else. `renderAfterTrace` and the planner chat (which passes none) are unchanged, so
scope is automatic exactly as VS-634 established.

## Risks / Trade-offs

- [`lh` units and jsdom] → Tests assert classes/structure, not pixels; the browser evidence covers the
  cap. If a target engine lacks `lh`, the fallback is the same class with a fixed line-height basis;
  no behaviour depends on it.
- [A ticket older than the 200-ticket query window cannot be expanded] → Pre-existing VS-634 limit;
  the chip itself only exists for tickets in that window.
- [A run transcript opened inside the small panel is cramped] → It scrolls inside the panel's cap, the
  same content the modal shows; the panel is a glance, the modal remains the full view.
- [Auto-collapse could surprise a reader mid-read] → Intended by the ticket ("automatically collapse
  when it's done"); it only fires on a terminal transition while open, and a finished ticket can be
  re-expanded and stays.
- [Two `useTicketComments`/`useTicketRuns` subscribers per open panel] → Same query keys, so one
  fetch and one cache entry per ticket; no new connection.

## Migration Plan

Frontend-only. Ships with the normal UI build (`pnpm --filter @weave-ai/ui build`); no daemon restart,
no migration, no API change. Rollback is reverting the commit.

## Open Questions

None that change the specs, the approach or the task breakdown.