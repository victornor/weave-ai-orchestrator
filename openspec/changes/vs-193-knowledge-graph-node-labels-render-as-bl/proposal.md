## Why

The Knowledge **Graph** tab is unreadable: most node labels do not paint at all (27 of 31 in
captain's report), and the layout that remains is an overlapping, off-canvas hairball. The
existing `knowledge/graph-exploration` spec already promises a readable default zoom, chips
that do not overlap, and titles visible at open — the implementation is not meeting its own
contract. Mobile portrait is the primary surface and is currently the worst-affected.

## What Changes

- Fix the blank-label defect: node chips whose label is not painting at the default view.
- Fix the mobile canvas viewport never being (re)measured against its real frame when the
  reader switches from the default phone neighbour list to the interactive canvas, which is
  the likely source of both the off-canvas overflow and the worst of the label/chip crowding.
- Make overlapping labels resolve by suppressing or fading rather than painting on top of one
  another, as a backstop for whatever spacing the force layout cannot fully resolve.
- Reduce visible edge crossings and tighten cluster separation so the graph's scope structure
  (workspace / shared / decisions / per-project) reads from the layout at the 31-page /
  67-link scale the ticket reports, without panning or zooming.
- Re-check the cluster hulls once the viewport fix lands — `hullPath` (`lib/graph/hull.ts`)
  is a correct convex hull over already-computed node positions, so the "hull clipped off the
  left edge" complaint is expected to trace back to the same stale-viewport defect rather than
  to the hull math itself; confirm with a screenshot before touching it.
- Keep Search, Zoom in/out, Fit, Reset and List working exactly as they do today.
- No backend or knowledge-data change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `knowledge/graph-exploration`: labels must never be painted over one another; the canvas
  viewport must be measured against its actual rendered frame, including when the frame
  becomes visible after being hidden; the layout must keep edge crossings and cluster overlap
  low enough to read the graph's structure at typical workspace scale without panning.

## Impact

- `packages/ui/src/routes/KnowledgeGraph.tsx` — node/label rendering, viewport measurement,
  phone list/canvas toggle.
- `packages/ui/src/lib/graph/simulation.ts` — collision sizing, cluster force strength.
- `packages/ui/src/lib/graph/viewport.ts` — default-view fitting, label-detail thresholds.
- `packages/ui/src/lib/graph/hull.ts` — only if the viewport fix does not also resolve the
  hull-shape complaint.
- No API, database or knowledge-data change.
