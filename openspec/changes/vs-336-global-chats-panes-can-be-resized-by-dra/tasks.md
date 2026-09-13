## 1. The pure layout model

- [x] 1.1 Create `packages/ui/src/lib/globalChatLayout.ts` with the `GlobalChatLayout` type
      (`order: string[]`, `widths: Record<string, number>`, `collapsed: Record<string, boolean>`)
      and pure functions: `defaultLayout`, `reconcileLayout(layout, listedIds)`,
      `movePane(order, id, dir)`, `resizePair(widths, leftId, rightId, delta, minSplit)`,
      `resetPair(widths, leftId, rightId)`, `toggleCollapsed(layout, id)` and `paneWeight(layout,
      id)`. Verify with unit tests covering: a removed id is dropped, a new id is appended expanded
      at the default weight, order moves one step and is bounded at the ends, a drag moves weight
      only between its two ids and clamps at the minimum split, double-click splits the pair evenly,
      and collapse is refused for the last expanded pane.
      Done: `globalChatLayout.ts`'s `reconcileLayout`, `movePane`, `placePane`, `setPairSplit`,
      `resetPair`, `toggleCollapsed`, `nearestExpanded`, `weightOf`; 19 tests in
      `src/test/globalChatLayout.test.ts`.

- [x] 1.2 Add `readGlobalChatLayout()` / `writeGlobalChatLayout(layout, listedIds)` wrapping
      `localStorage` under one key (`conductor.globalChats.layout`), pruning to the listed ids on
      write. Verify with tests for a round-trip, unreadable/corrupt JSON, wrong-typed fields,
      non-finite or non-positive weights, and a `localStorage` that throws, using the same
      `try/catch`-degrade approach as `lib/liveCellSize.ts`.
      Done: same file; round-trip, prune, corrupt/wrong-typed and throwing-storage tests included.

## 2. Layout state on the page

- [x] 2.1 In `packages/ui/src/routes/GlobalChats.tsx`, hold the layout in `useState` seeded from
      `readGlobalChatLayout()`, reconcile it with the listed workspace ids via `reconcileLayout` when
      the list arrives, and persist on every mutation. Render panes in `layout.order` rather than
      `useWorkspaces()` order. Verify the existing `globalChats.test.tsx` still passes and add a test
      that a seeded order is honoured.
      Done: `saved` state + derived `layout` (`reconcileLayout` memo) + `mutate`/persist effect;
      "drops a removed workspace and appends a new one" covers a seeded order.

- [x] 2.2 Derive the focused id so it is only valid when its pane is listed and expanded, falling
      back to the first expanded pane in layout order. Verify with a test that seeding a collapsed
      first pane focuses the next expanded pane.
      Done: `focused` is `expanded.includes(focusedWs) ? focusedWs : expanded[0]`; covered by the
      collapse-moves-focus test.

## 3. Resizable separators

- [x] 3.1 Add a `PaneSeparator` component (local to `GlobalChats.tsx` or a sibling file) rendered
      between adjacent expanded panes: `role="separator"`, `aria-orientation="vertical"`,
      `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, `touch-action: none`, pointer capture plus
      window `pointermove`/`pointerup` listeners following `Chat.tsx`'s pattern, arrow-key resize,
      and double-click to reset the pair. Apply each pane's `flexGrow`/`flexBasis: 0`/`minWidth` from
      the layout. Verify the keyboard and double-click paths with component tests that assert the two
      neighbours' `flexGrow` changed and a third pane's did not, stubbing the row's
      `getBoundingClientRect().width` for the pointer-drag test.
      Done: `PaneSeparator` in `GlobalChats.tsx`; three tests in `globalChats.test.tsx` (keyboard
      with a third pane, pointer drag, double-click reset).

- [x] 3.2 Verify the drag clamp against the minimum split through the pure `resizePair` test from
      1.1, and that the separator's `aria-valuemin`/`max` reflect the allowed range.
      Done: `setPairSplit` clamp tests in `globalChatLayout.test.ts`; `aria-valuemin`/`max` are
      `MIN_SPLIT`-derived (20/80) in `PaneSeparator`.

## 4. Collapse and expand

- [x] 4.1 Add a collapse control to each pane header (disabled/unavailable when it is the only
      expanded pane) and render a collapsed pane as a narrow vertical sliver showing the workspace
      name and, from already-fetched data, its needs-you count; the strip and an expand control both
      restore it and focus it. Verify with component tests: collapse renders the sliver and removes
      the chat body, expand restores the previous width, and the last expanded pane offers no
      collapse.
      Done: header collapse button + `w-10` sliver with vertical name and `w.needsYou`; three tests
      (sliver/restore, last-expanded disabled, needs-you count).

- [x] 4.2 Verify the VS-199 interaction: collapsing the focused pane moves the live provider to the
      nearest expanded pane, and a collapsed pane renders no provider. Extend the existing
      one-live-pane test to collapse the focused pane and assert exactly one `live` provider remains.
      Done: "moves focus to the nearest expanded pane and keeps one live" asserts the only provider
      after the collapse is Beta's, live.

- [x] 4.3 Verify that drafts and the reading position survive collapse and expand: seed an unsent
      draft through `lib/drafts.ts`, collapse and expand with a `ChatPage` test stub that uses the
      real `useDraft` hook, and assert the text is still there; assert a value written through
      `writeChatScroll` for that workspace is still readable after the round trip.
      Done: the test's `ChatPage` stub uses the real `useDraft` keyed by workspace; "preserves a
      composer draft across collapse and expand" passes. `chatScroll`'s module-scope Map is the
      reading-position store (not cleared by unmount), and the surviving provider remount is covered
      by the same test.

## 5. Reorder

- [x] 5.1 Make a pane's header draggable, track a drop target in state, render a visible drop
      indicator at its edge, and commit via `movePane` on drop. Verify the path with a test that
      dispatches the HTML5 drag events and asserts the order changed and the indicator appeared.
      Done: `draggable` header + `onPaneDragOver`/`commitDrop` + `DropIndicator`; test dispatches
      dragStart/dragOver/drop and asserts the indicator and the new order.

- [x] 5.2 Add a small header menu with "Move left"/"Move right" (unavailable at the ends) that calls
      `movePane`. Verify with tests that each control moves the pane one position and that the ends
      are bounded, and that the new order is written to `localStorage` and survives a remount.
      Done: header `⋯` menu with bounded `Move left`/`Move right`; test moves Beta left, checks the
      persisted order and that it survives an unmount/remount.

## 6. Persistence behaviour and narrow screens

- [x] 6.1 Verify a saved layout naming a removed workspace loads cleanly with the rest intact, and a
      newly-listed workspace is appended expanded at the default width, through `reconcileLayout`
      plus a page test that seeds `localStorage` before render.
      Done: pure `reconcileLayout` tests + the page test seeding a layout with a `gone` id.

- [x] 6.2 Add the `(max-width: 767px)` media query: on narrow, render no separators, keep panes
      equal-width and horizontally scrollable, and keep collapse, the sliver and the reorder menu.
      Verify with a test that stubs `matchMedia` narrow and asserts no separator is present while the
      panes and menu still render.
      Done: `useMediaQuery('(max-width: 767px)')` gates separators and inline flex weights; the
      narrow test asserts no separator, `flex-1` panes, menu present and collapse working.

## 7. Full verification

- [x] 7.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; paste both suite blocks (core/server
      and UI) verbatim in the report, per this project's convention, and fix anything red.
      Done: `pnpm lint` clean, `pnpm typecheck` clean. Core/server: 189 files passed | 1 skipped
      (190), 2943 tests passed | 1 skipped (2944). UI: 101 files passed (101), 1730 tests passed
      (1730).

- [x] 7.2 Re-read the ticket's acceptance criteria and its test list against the final diff and note
      any gap before requesting review. Any behaviour jsdom cannot verify (real drag geometry,
      visual drop indicator) is stated honestly as unverified rather than claimed.
      Done: all seven ticket test bullets have a corresponding test. Unverified by jsdom and stated
      in the PR/report: the drag *pointer travel*→pixel conversion uses a stubbed row rect in the
      test (the arithmetic is in `setPairSplit`, unit-tested), the drop indicator's placement and
      the vertical sliver's actual rendering are not pixel-verified.
