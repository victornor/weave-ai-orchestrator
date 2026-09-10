## Why

The Live page (VS-152) shows every currently-working worker as an equal cell. Captain wants to make the workers they are watching larger and the rest smaller, by dragging, with the grid adjusting around the new sizes. Equal cells waste the floor when one turn matters more than the others.

## What Changes

- **Desktop (sm and up): each live cell can be resized by dragging.** A handle on the cell (corner / edges) grows or shrinks that cell. Neighbours reflow so the layout stays packed and usable — not a free-floating overlay and not a splitter that steals size from a sibling.
- **Phone: no drag-resize.** Dragging a handle fights scrolling at one-column width. Each cell instead offers a tap-to-expand control that enlarges that cell's transcript; tapping again restores it. Drag handles are not present at that breakpoint.
- **Sizes last for the tab session.** Chosen sizes (and which cell is expanded on the phone) are remembered in `sessionStorage` per workspace, keyed by worker id, so a reload in the same tab keeps the layout. They are not written to `localStorage` or the daemon: workers are ephemeral, and a durable store would accumulate dead keys. Private-mode / storage-refusal still resizes for the session.
- **Empty, loading and error states are unchanged.** No handles, no expand controls, no skeleton that pretends to be resizable.
- **Nothing else about a cell changes.** Membership, streaming, ticket link, and "not a control surface" stay as VS-152 specified. No close/hide, no steering, no cross-workspace floor.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `workspace-navigation/live-floor`: cells on the Live page are resizable on desktop (drag, grid reflows) and expandable on the phone (tap, no drag). Empty/loading/error states stay as they are.

## Impact

- `packages/ui/src/routes/Live.tsx` — grid cells gain a size (column/row span) and a resize handle on `sm+`; a tap-to-expand control below `sm`; transcript max-height follows the cell's size.
- `packages/ui/src/lib/liveCellSize.ts` (new) — read/write/clamp of `{ cols, rows }` (and the phone expanded flag) in `sessionStorage`, same guarded-storage pattern as `decisionHeight.ts`.
- `packages/ui/src/test/liveFloor.test.tsx` — drag changes span; reset; session restore; phone has expand not drag; empty/loading still have no handles.
- No daemon, schema, API, event, PLAN, or TUI change. No new dependency.
