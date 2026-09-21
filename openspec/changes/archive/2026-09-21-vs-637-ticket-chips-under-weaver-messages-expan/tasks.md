## 1. The chip's expand control

- [x] 1.1 In `packages/ui/src/v2/ChatChips.tsx`, split `V2DispatchChip` into a body button (keep
      `data-v2-dispatch-chip` and its `aria-label`; it still calls `onClick`) and a sibling chevron
      button (`data-v2-chip-expand`, `aria-expanded`, `aria-controls`, `aria-label` naming the ticket
      and the action, Lucide `ChevronDown` rotated when expanded, touch-sized padded box), both inside
      one `v2-tag` container, rendered only when an `onToggle`/`expanded` pair is passed. Verify with
      `pnpm --filter @weave-ai/ui typecheck`.
- [x] 1.2 Extend `packages/ui/src/test/v2ticketstrip.test.tsx`: the chevron toggles `aria-expanded`
      and calls `onToggle` while the chip body still calls `open` and neither crosses over; the
      chevron is a separate element from the body. Verify
      `pnpm --filter @weave-ai/ui test -- v2ticketstrip`.

## 2. The inline panel

- [x] 2.1 In `packages/ui/src/v2/ChatChips.tsx`, add the panel: `V2TicketStrip` owns `openIds:
      string[]` and renders, under the chip row and inside one message block, the panel for each open
      id through `useExitPresence(openIds, (id) => id, reduced ? 0 : 180)`. The panel renders
      `TicketActivityFeed` (the modal's component) inside a `max-h-[10lh] overflow-y-auto` scroller
      (content height when shorter), passing `ticket`, `worker?.name ?? null` and `onTicket = open`; it wires
      `useStickToBottom([...], { contained: true, ready })` from `useTicketComments(ticket.id)` /
      `useTicketRuns(ticket.id)` (cache hits under `TicketActivityFeed`'s own keys), with `useId` for
      `aria-controls`. The feed renders only for open ids. Verify
      `pnpm --filter @weave-ai/ui typecheck`.
- [x] 2.2 Add `packages/ui/src/test/v2ticketchippanel.test.tsx`: expanding mounts the feed
      (`[data-ticket-activity-feed]`) and collapsing unmounts it; no feed is mounted while collapsed;
      two chips can be expanded at once; the panel sits after the chip row inside the strip; the
      scroller carries the height cap and `overflow-y-auto`; expanded chip references link through the
      shared `open`. Keep `connectionBudget.test.tsx` green. Verify
      `pnpm --filter @weave-ai/ui test -- v2ticketchippanel v2ticketstrip connectionBudget`.

## 3. Auto-collapse and motion

- [x] 3.1 In `V2TicketStrip`, arm an id when expanded while its ticket is non-terminal and remove an
      armed id from `openIds` when its ticket reaches `TERMINAL_TICKET_STATUSES`; never arm an
      already-terminal ticket; skip the exit hold under reduced motion so the feed unmounts
      immediately. Verify `pnpm --filter @weave-ai/ui typecheck`.
- [x] 3.2 Extend `packages/ui/src/test/v2ticketchippanel.test.tsx`: a status change to `done` while
      open collapses it and unmounts the feed; a change to `in_review` does not; a ticket already
      `done` when expanded stays open; `cancelled` collapses; reduced motion removes the panel without
      the transition. Verify `pnpm --filter @weave-ai/ui test -- v2ticketchippanel`.

## 4. Rendered evidence and full checks

- [x] 4.1 Capture rendered evidence with a real browser against the built app
      (`pnpm --filter @weave-ai/ui build`): a weaver conversation with a message whose chips include
      one expanded ticket with a live feed (working) and one collapsed; the same after the ticket is
      done (collapsed, final status showing) — in both themes at desktop 1440 and at phone 390. State
      any spacing change from the chip row today. Save captures outside `work/`, open each to confirm
      it shows what is intended, and attach each with `weave_ticket_attachment_put`; verify they
      appear on the ticket.
- [x] 4.2 Run `pnpm lint`, `pnpm typecheck` and one full `pnpm test` with `VITEST_MAX_WORKERS=4`;
      verify green and paste both suite blocks verbatim in the report.