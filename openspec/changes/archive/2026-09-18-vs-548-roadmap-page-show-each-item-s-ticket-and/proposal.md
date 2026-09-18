## Why

A started roadmap block files a real ticket per pending item, but the Roadmap page still shows only
the item's identifier link and never the ticket's status, so a started or done block cannot be read
without leaving the page. The same page also renders every item of every block, so the growing UI
polish block dominates the screen instead of reading as a list of blocks.

## What Changes

- **Show each pending ticket's real ticket and its status.** A pending item linked to a ticket shows
  that ticket's identifier as a link plus its current status (read live from the workspace ticket
  list, so a status change updates without a reload). An item with no ticket yet reads `unfiled`
  instead of showing nothing.
- **Collapse blocks, collapsed by default.** Each block on the Roadmap page gains a disclosure
  control; a block is collapsed when the page first loads and can be expanded. Collapsed, it still
  shows its title and how many items it holds. The per-block expanded/collapsed choice is remembered
  in this browser across reloads. The control is reachable and legible at phone width.

No backend, API or data change: the ticket identifier and status are already on the ticket rows the
page fetches, and the freshness is the page's existing event-stream invalidation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `roadmap/roadmap-page`: the page's rendering of a pending ticket gains the linked ticket's current
  status and an explicit unfiled marker, and its blocks become collapsible with a per-block
  preference remembered in the browser, collapsed by default.

## Impact

- `packages/ui/src/v2/project/RoadmapPage.tsx` — resolve each pending item's ticket to its
  identifier and status; render the status tag and the `unfiled` marker; wrap each block in a
  disclosure control with a remembered expanded/collapsed state.
- `packages/ui/src/v2/prefs.ts` — one device-remembered key for the expanded block ids.
- `packages/ui/src/test/v2roadmap.test.tsx` — cover the ticket status, the unfiled marker, the
  collapsed-by-default state, expansion, and the remembered choice.
- `docs/PLAN.md` — the §21.1 sentence describing the Roadmap page gains the ticket status and the
  collapsible blocks.
- No dependency change, no V1 surface, no server or schema change.
