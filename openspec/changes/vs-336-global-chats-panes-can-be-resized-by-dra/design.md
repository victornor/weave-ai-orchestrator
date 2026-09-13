## Context

`GlobalChats.tsx` (see `conductor-chat/global-chats`) renders `listed.map(...)` into a horizontal
flex row: each pane is `<section className="… min-w-80 flex-1 … border-r …">` with a header `<button>`
that focuses it, and a `WorkspaceProvider live={…}` + `ChatPage`. `focusedWs` defaults to
`listed[0].id`. Nothing about the row is persisted. Order is `useWorkspaces()` order.

Three existing hand-rolled handles are in the tree (`Chat.tsx`'s decisions separator,
`KnowledgeExplorer.tsx`'s divider, `Live.tsx`'s `ResizeHandle`). They differ in axis and unit — the
decisions one drags an absolute pixel height, the explorer one drags a pixel width with
`cursor-col-resize`, the Live one snaps 2-D grid spans — so there is no gain in extracting one
abstraction across all three, and the ticket says not to rewrite the other two. This change adds a
fourth, self-contained vertical separator following the same shape.

The important existing behaviour to preserve is VS-199: exactly one pane is `live`. Collapse must not
be able to make that invariant inconsistent.

## Goals / Non-Goals

**Goals:**
- One page-local layout model (order, width weights, collapsed set) that is pure and unit-testable,
  with `localStorage` only at the edge.
- Reuse the app's established separator pattern rather than add a drag-and-drop dependency.
- Keep the change inside `GlobalChats.tsx` + one new lib module + tests.

**Non-Goals:**
- Rewriting or extracting the decisions separator, the Knowledge Explorer divider or the Live
  `ResizeHandle`.
- Server-side persistence; the layout is per browser and per `localStorage`, like the ticket asks.
- Making a collapsed pane's sliver scrollable or interactive beyond expand.
- Drag-to-reorder by touch (the menu's Move left/right covers keyboard and touch).

## Decisions

**Widths are stored as positive flex-grow *weights*, not pixels or container fractions.** A pane's
style becomes `flexGrow: weight, flexBasis: 0, minWidth: 20rem` (today's `min-w-80`). Weights are
inherently proportional, so a layout saved wide needs no pixel interpretation on a narrow screen, and
the browser's flex algorithm plus `min-width` keeps panes readable with horizontal scroll as the
fallback. Nothing needs the row's rendered width to *lay out*; only a pointer drag needs it, to turn
a pixel delta into a weight delta, and that width is read once from `getBoundingClientRect()` on the
row at drag start (real DOM input, not logic). Alternative considered — storing pixel widths and
re-clamping — needs a container measurement to clamp against and freezes a wide-screen layout onto a
narrow one; fractional weights are simpler and meet the same requirement.

**A drag changes exactly two weights and is clamped by a minimum split.** `resizePair(weights,
leftId, rightId, deltaWeight, minSplit)` moves `deltaWeight` from one neighbour to the other, keeping
each at no less than `minSplit × (wLeft + wRight)` of the pair's combined weight. The pair's total is
conserved, so no third pane moves. The CSS `min-width` is the readability guarantee; the min split is
the guard against an unusable 99/1 stored state. Double-click calls `resetPair`, which splits the
pair's combined weight evenly.

**Collapse replaces the chat body with the sliver and unmounts `ChatPage`.** The two things the
ticket says must survive are both already stored outside the component and keyed by workspace:
composer drafts in `sessionStorage` (`lib/drafts.ts`, `draftKey(ws, 'thread:<id>')`) and the reading
position in a module-scope `Map` (`lib/chatScroll.ts`), which outlives an unmount for the life of the
tab. Unmounting avoids the `display:none` scroll-reset trap that keeping a hidden `overflow:auto`
body mounted would hit, and needs no "render it at its old width but clipped" trick. A collapsed pane
is never `live` (below), so unmounting one never closes the one live subscription. `ChatPage`'s
thread id is the workspace's primary web thread, stable across a remount, so its draft key is
unchanged.

**A collapsed pane is never focused, and focus is derived, not stored.** The focused id is valid only
if it is listed and not collapsed; otherwise it falls back to the first expanded pane in layout order.
Collapsing the focused pane therefore moves focus to the nearest expanded pane by construction.
`collapse` is refused when it would leave zero expanded panes, which keeps a focused pane existing
whenever a workspace is listed.

**Reordering uses HTML5 drag events on the header plus a header menu, and the mutation is pure.**
`draggable` on the header with `onDragStart`/`onDragOver`/`onDrop` sets a "drop before pane X /
after the last pane" target held in component state; a thin accent bar renders at that edge. The
same reorder is available as `movePane(order, id, -1 | +1)` from a small menu, which is what the
tests drive and what keyboard/touch use; the drag path only computes the target index and calls the
same function. This avoids a drag library and avoids pointer-based reorder code that jsdom cannot
exercise.

**A phone-width viewport drops the separators and keeps everything else.** `useMediaQuery('(max-width:
767px)')`, matching `Chat.tsx` and `KnowledgeExplorer.tsx`. Below it, panes are `min-w-80 flex-1`
(equal, horizontally scrollable) with no separators; collapse, the reorder menu and the sliver remain.

**`localStorage` is one layout object keyed by workspace id inside it.** The ticket's "keyed by
workspace id" is read as: the order array holds ids and the per-pane width/collapsed maps are keyed
by id. One key, `conductor.globalChats.layout`, is right because the layout spans all workspaces;
per-workspace keys would leave ordering homeless. `readGlobalChatLayout` parses defensively (bad
JSON, wrong types, non-finite or non-positive weights are dropped) and `writeGlobalChatLayout`
prunes to the ids currently listed, so a workspace the daemon stops reporting is dropped rather than
reappended on its return.

## Risks / Trade-offs

- **[Risk] `localStorage` corrupts or is unavailable.** → `read`/`write` are wrapped in `try/catch`
  and validate every value; a bad layout degrades to defaults for the visit and is rewritten
  cleanly.
- **[Risk] Collapse could break VS-199's one-live-pane invariant.** → A collapsed pane renders no
  `WorkspaceProvider` at all, and focus is derived so it can never point at a collapsed pane; the
  existing test that counts live providers is extended to collapse the focused pane and re-count.
- **[Risk] jsdom cannot measure a flex row, so a pointer drag is not directly assertable.** →
  `resizePair` is a pure function tested with explicit widths; the component test stubs the row's
  `getBoundingClientRect().width` and asserts the two neighbours' `flexGrow` changed while the third
  did not.
- **[Risk] Reorder + persistence can drift when the workspace list changes between visits.** →
  `reconcileLayout` is the single place that merges saved state with the live list, unit-tested
  against removed, added and reordered id sets.
