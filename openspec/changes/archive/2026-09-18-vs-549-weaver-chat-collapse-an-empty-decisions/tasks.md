# Tasks

## 1. Collapse an empty decisions pane

- [x] 1.1 `packages/ui/src/v2/chatSplit.ts`: add and export `DECISIONS_RAIL_WIDTH` (~36px, the
  collapsed pane's width) beside `SPLIT_MIN_WIDTH` and the divider bounds, with a comment saying it is
  the collapsed rail, not a divider bound. Verify: the `chatSplit` describe in
  `packages/ui/src/test/v2chat.test.tsx` (or a small unit assertion there) imports it and checks it is
  a positive width narrower than `DIVIDER_MIN`.
- [x] 1.2 `packages/ui/src/v2/ChatPage.tsx`: add `panePinned` state and
  `expanded = canSplit && (openDecisionCount > 0 || panePinned)`, clear the pin with an effect keyed
  only on `openDecisionCount` when it reaches 0, and pass `collapsed`, `onExpand` and `onCollapse` to
  `DecisionsPane`. Verify: the effect is keyed on the count so a hand-expanded empty pane is not
  immediately collapsed.
- [x] 1.3 `packages/ui/src/v2/ChatPage.tsx`'s `DecisionsPane`: keep one `<aside data-decisions-pane>`
  flex child whose inline width moves between `DECISIONS_RAIL_WIDTH` and `divider`, animated by an
  inline `transition: width var(--v2-dur-base) var(--v2-ease)` (already zeroed under reduced motion);
  render the resizable divider handle only when expanded; when collapsed, render a vertical
  "Decisions" label and an expand button labelled "Expand decisions" with `aria-expanded="false"`; when
  expanded, render the existing header, cards and empty state plus a collapse button labelled "Collapse
  decisions", shown only while `openDecisionCount === 0`. Add a `data-decisions-pane-collapsed`
  marker to the collapsed rail. Verify: the pane is one element in both states (no duplicate
  `V2DecisionCard`), and the divider separator is absent while collapsed.
- [x] 1.4 Confirm `showInlineDecisionCard` still means "the pane is not showing the card": because a
  decision is what expands the pane, an open decision on desktop always lands in the pane, and below
  the threshold pane and rail are both absent. Verify by the phone/desktop scenarios in task 2.

## 2. Collapse behavior tests

- [x] 2.1 Rewrite the existing `keeps the decisions pane on desktop when nothing is waiting` case in
  `packages/ui/src/test/v2chat.test.tsx`: at 900px with no decisions the pane is present and marked
  collapsed with its expand control; with an open decision it is not collapsed and shows the card;
  below the split threshold (500px) neither the pane nor the rail is present. Verify with
  `pnpm vitest run packages/ui/src/test/v2chat.test.tsx`.
- [x] 2.2 Add cases covering the live count: a decision arriving on a rerender expands the pane without
  a reload; answering the last decision (via the mocked `useAnswerDecision` / the refetched open list)
  collapses it again; activating the rail's expand control on an empty pane shows the empty state and
  the collapse control returns it to the rail. Verify in the same suite.
- [x] 2.3 Confirm no regression to the inline-card behavior: the existing phone/desktop
  `renders an open decision inline on phone and nothing in the desktop conversation` case stays green.
  Verify in the same suite.

## 3. Show the chosen block on a sent message

- [x] 3.1 `packages/ui/src/api/hooks.ts`: add `useRoadmapBlockTitles(projectIds: readonly string[])`,
  a `useQueries` over the existing `qk.roadmapBlocks(ws, id)` key returning a `Map<blockId, title>` from
  every resolved project's blocks; no new route, and a project with no messages contributes no query.
  Verify: a hook test (`packages/ui/src/test/` alongside the existing query-hook tests) mounts it with
  a `QueryClient` seeded per project and asserts the merged map, and that an empty list issues no
  fetch.
- [x] 3.2 `packages/ui/src/v2/ChatMessage.tsx`: add an optional
  `blockName?: (id: string | null) => string | null` prop; after the project tag, render a
  `v2-tag text-text-3` marker with the resolved title when `message.blockId` is set and a title
  resolves, and nothing otherwise; add `data-block-tag` for tests and `flex-wrap` to the metadata row
  so the marker never displaces the body. Verify: a `ChatMessage` test asserts the marker's text, that
  no marker renders without a title, and that a project-only message is unchanged.
- [x] 3.3 `packages/ui/src/v2/ChatConversation.tsx` and `ChatPage.tsx`: pass an optional
  `blockName` resolver through to `ChatMessage` (and to `JumpView`'s direct `ChatMessage`); in
  `ChatPage` collect the distinct `projectId`s among messages carrying a `blockId`, build the resolver
  from `useRoadmapBlockTitles`, and leave it absent where it is not wanted (the Plan modal's planner
  chat). Verify: `packages/ui/src/test/v2chat.test.tsx` sends/uses a message with a `blockId` and
  asserts both the project and block tags render, a project-only message shows the project tag alone,
  and an unresolvable block shows neither an id nor a marker.
- [x] 3.4 Update the `../api/hooks` mock in `packages/ui/src/test/v2chat.test.tsx` to provide
  `useRoadmapBlockTitles`, or the screen throws on the missing hook. Verify: the suite runs.

## 4. Checks and rendered evidence

- [x] 4.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` green from `work/`; paste **both** suite
  blocks (core/server and UI) verbatim, never summed and never one presented as both.
- [x] 4.2 Rendered captures in light and dark, at desktop and phone width, for **both** items: the
  decisions pane collapsed and expanded (part 1), and a message sent with a project and a block beside
  one with a project only (part 2). Build them from a throwaway harness outside `work/` that mounts the
  real components against mocked `/api` data (nothing reaching a live daemon), capture with the host's
  headless Chromium, open each capture to confirm it shows what was intended, and attach them to
  VS-549 with `weave_ticket_attachment_put` — not by committing binaries or citing paths.
  `git status --porcelain` in `work/` is empty before the review request.
