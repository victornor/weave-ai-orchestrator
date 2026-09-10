## Why

Captain, 2026-09-10: the knowledge graph opens as a tight cluster of tiny coloured
blobs, has no zoom controls, and does not look like the rest of AgentConductor.
Wheel/pinch already exist, but opening continuously auto-fits the whole graph so
nodes collapse to unreadable dots and labels drop below the zoom threshold.

## What Changes

- Opening the graph starts at a **readable default zoom** centred on the layout,
  not a fitted overview that shrinks every node into a blob. Fit remains a
  control; it is no longer the first paint.
- The force layout **spreads out**: longer link distances, more collision
  padding, weaker clustering, so pages are not packed on top of each other.
- **Zoom in / zoom out buttons** sit next to Fit and Reset. Wheel and pinch stay.
- Nodes are **labeled chips** using the app's type, colour tokens and chrome
  (`ac-card` / `text-micro` / `--line-*` / `--bg-*`, group colour as an accent) —
  not filled circles and diamonds. Hubs stay distinguishable from documents.
- The graph stays on the existing knowledge route. No new IA.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `knowledge/graph-exploration`: default viewport is a readable, spread-out view
  rather than a fitted overview; zoom in/out controls are required; nodes are
  labeled chips in the app's visual language rather than unmarked blobs.

## Impact

- `packages/ui/src/routes/KnowledgeGraph.tsx` — default transform, zoom buttons,
  node chrome.
- `packages/ui/src/lib/graph/simulation.ts` — spacing (link distance, collide,
  cluster strength) and chip-sized radii.
- `packages/ui/src/lib/graph/viewport.ts` — default-view helper that floors zoom
  so labels are visible at first paint.
- Tests: `knowledgeGraph.test.tsx` (default transform, zoom buttons),
  `graphViewport.test.tsx` (default view), `graphSimulation.test.tsx` (spacing).
- No API, daemon, CLI, Telegram or TUI change. Cluster hulls, search, filters,
  pin/drag, phone neighbour-list and reduced motion stay.
