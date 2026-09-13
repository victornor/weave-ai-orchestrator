## Why

The global Chats page shows every workspace's weave chat in one equal-width column
(`packages/ui/src/routes/GlobalChats.tsx`). Captain wants to give one workspace more room, fold a chat
he wants out of the way down to a sliver, and put the workspaces he reads most on the left — and have
all of that stay put across reloads. Today the page has none of this: every pane is `flex-1 min-w-80`,
ordered by whatever `useWorkspaces()` returns, and nothing is remembered.

## What Changes

- A vertical separator between adjacent expanded panes. Dragging it moves width between those two
  neighbours only (each keeps a minimum readable width); arrow keys resize it and double-click resets
  the pair to equal widths. `role="separator"` with `aria-valuenow`/`min`/`max` and `touch-action:
  none`, following the app's existing hand-rolled handles.
- Each pane header gets a collapse control. A collapsed pane becomes a narrow vertical sliver showing
  the workspace name and, when already available, its needs-you count; the sliver or its expand
  control restores the pane to its previous width. A collapsed pane is never the focused (live) pane;
  collapsing the focused pane moves focus to the nearest expanded one, and the last expanded pane
  cannot be collapsed (VS-199's one-live-pane rule is preserved).
- Panes can be reordered by dragging a pane's header (with a visible drop indicator) and, for
  keyboard and touch, by "Move left"/"Move right" controls in a small header menu. No new dependency.
- Order, widths and collapsed state persist per browser in `localStorage`. A workspace that appears
  later is appended as an expanded pane at the default width; one that disappears is dropped without
  disturbing the rest; stored widths are proportional so a layout saved on a wide screen stays usable
  on a narrow one.
- On a phone-width viewport, dragging-to-resize is disabled and the page relies on horizontal scroll
  plus collapse and the reorder menu; nothing overflows unusably.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `conductor-chat/global-chats`: the pane layout gains resizable separators, per-pane collapse to a
  sliver, reordering, and per-browser persistence, and the "exactly one pane is live" requirement
  gains its interaction with collapse (a collapsed pane is never focused; collapsing the focused
  pane moves focus to the nearest expanded pane).

## Impact

- `packages/ui/src/routes/GlobalChats.tsx` — the page's layout, focus selection, and per-pane header.
- A new `packages/ui/src/lib/globalChatLayout.ts` — the pure layout model (weights, order, collapsed
  state, reconciliation, drag/keyboard mutations) and its `localStorage` read/write.
- `packages/ui/src/test/globalChats.test.tsx` and a new unit test for the layout model.
- No server route, no `useWorkspaces()` change, and no dependency added. The existing per-workspace
  chat, the decisions separator (`Chat.tsx`), the Knowledge Explorer divider and the Live
  `ResizeHandle` are untouched.
