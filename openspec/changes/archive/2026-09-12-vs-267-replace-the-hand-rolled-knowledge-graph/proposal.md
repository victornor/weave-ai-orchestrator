## Why

The knowledge graph (`KnowledgeGraph.tsx` + `lib/graph/{viewport,simulation,model,filters,hull}.ts`)
is unusable: scroll-wheel zoom fights the page instead of the graph, arrows point at empty space,
and chips overlap. Five prior passes (VS-64, VS-175, VS-180, VS-193, and label-suppression patches)
re-tuned constants without fixing either root cause. Captain's instruction was to stop iterating and
adopt something that already exists. VS-264 (scout) built a real-browser repro, confirmed both
defects precisely, and evaluated seven libraries; this change implements its recommendation.

The two confirmed root causes:

1. **Event ownership, not arithmetic.** `KnowledgeGraph.tsx` attaches its wheel listener in a
   `useEffect` — after first paint — and relies on `preventDefault()` to win the gesture from
   page-scroll. The zoom math itself is correct and already tested; no amount of re-tuning it fixes
   an event-ownership problem. A library that owns the interaction from the moment the element
   exists (as `d3-zoom`-based libraries do) is what a hand-rolled `useEffect` listener cannot be.
2. **A circle standing in for a rectangle.** `nodeRadius()` returns `max(width, height) / 2` and is
   used both to trim edges and to drive `forceCollide`. A wide, short chip's real geometry is nothing
   like the circle approximating it, so edges arriving from above/below a chip stop ~84 units short
   of its visible rectangle, and collision under-resolves overlap for the same reason. The codebase
   already has the right test (`chipsOverlap`, an axis-aligned box test) — it is wired only to
   `suppressedLabels()`, which hides the symptom (a label) rather than the cause (the rectangle
   collision).

## What Changes

- **Adopt `@xyflow/react` (React Flow) for rendering and interaction; keep `d3-force` for layout.**
  React Flow owns wheel/pinch/pan from the moment the canvas mounts (fixing root cause 1) and
  renders nodes as real React components, so the existing chip styling and CSS-token dark mode carry
  over. `d3-force`'s simulation (`clusterForce`, `seedRing`, `reconcileNodes`, the tuned force
  parameters) stays and feeds React Flow's node positions each tick, per React Flow's documented
  external-layout pattern.
- **Fix edge trimming.** Replace the circular `nodeRadius()` trim in `edgePath()` with a rectangle
  intersection: the edge stops where the line from one chip's centre to the other's actually crosses
  the source chip's rectangle boundary, computed from the chip's real half-width/half-height, not a
  circumscribed circle.
- **Fix collision.** Replace `forceCollide`'s circular radius with a rectangle-aware separation
  force built on the same axis-aligned-box test `chipsOverlap()` already implements, so overlap is
  actually resolved during layout rather than only hidden afterwards.
- **Narrow `suppressedLabels()`'s job.** Once collision is rectangle-aware, two settled chips should
  not overlap at all; `suppressedLabels()` remains only as a backstop for the transient overlap that
  can appear mid-drag or mid-reheat, before the layout has resettled — not as the permanent cover for
  a layout that could never separate chips on its own.
- **Remove the hand-rolled pointer/wheel/pinch/drag plumbing from `KnowledgeGraph.tsx`**
  (`onPointerDown`/`onPointerMove`, the wheel `useEffect`, `applyView`/`moveView`/`toSvg`, the manual
  `nodeRefs`/`edgeRefs`/`hullRefs` DOM-ref bookkeeping) in favour of `<ReactFlow>` and custom
  node/edge components. `KnowledgeGraph.tsx` stops importing `lib/graph/viewport.ts`.
- **`lib/graph/viewport.ts` is not deleted.** `MapCanvas.tsx` (the Instance Map, VS-192) imports it
  and reimplements the same pattern; migrating that view is explicitly out of scope for this change,
  so `viewport.ts` keeps serving it. Any export `viewport.ts` has only because `KnowledgeGraph.tsx`
  used it is removed; everything `MapCanvas.tsx` still imports stays.
- **Survives largely unchanged:** `model.ts`, `filters.ts`, `hull.ts` (React Flow does not draw
  cluster backgrounds), and the force configuration in `simulation.ts` — rewired to feed React
  Flow's node positions instead of writing SVG attributes through refs.

## Capabilities

### Modified Capabilities

- `knowledge/graph-exploration`: the viewport's wheel/pinch/pan is now owned by the rendering
  library from the moment the canvas exists, instead of a `useEffect`-attached listener racing the
  page for the gesture. An edge trims to the target chip's rectangle boundary instead of a
  circumscribed circle. The settled layout SHALL leave no two chips' rectangles overlapping — label
  suppression is now a transient backstop, not the resolution mechanism for a genuinely unresolved
  overlap. Node dragging, pinning, search, filters, cluster hulls, the detail panel, the phone
  neighbour list, reduced motion and theming are all unchanged in behaviour; scenarios covering them
  are not modified.

## Impact

- `packages/ui/package.json` — new dependency `@xyflow/react` (MIT; freely combinable with this
  repo's `AGPL-3.0-only`, per VS-264's licence check). No new dependency for `d3-force`, which stays.
- `packages/ui/src/routes/KnowledgeGraph.tsx` — rewritten render/interaction layer against
  `<ReactFlow>`; `GraphDetailPanel` and `GraphNeighbourList` (non-canvas) are unaffected structurally
  but may move file if the route file is split.
- `packages/ui/src/lib/graph/simulation.ts` — `nodeRadius()`'s use in edge trimming and collision is
  replaced by rectangle-based geometry; `chipSize`, `chipsOverlap`, `clusterForce`, `seedRing`,
  `reconcileNodes` and the tuned parameters survive. New: a rectangle intersection helper and a
  rectangle-aware collision force.
- `packages/ui/src/lib/graph/viewport.ts` — unchanged; still imported by `MapCanvas.tsx` only after
  this change lands. Exports used only by the old `KnowledgeGraph.tsx` are removed if nothing else
  references them.
- `packages/ui/src/test/knowledgeGraph.test.tsx` — substantially rewritten against the new component
  shape (React Flow's DOM structure differs from the hand-rolled SVG).
- `packages/ui/src/lib/graph/simulation.test.ts` — extended for the new rectangle geometry; existing
  `chipsOverlap`/`suppressedLabels` cases are retained since their contracts do not change.
- Not touched: `MapCanvas.tsx`, `lib/map/*`, the document explorer (VS-265, coordinating by staying
  out of its files).

## Out of scope

- Migrating `MapCanvas.tsx` (the Instance Map) to React Flow. It has its own radial-tree layout
  (VS-192) and its own reasons to keep the hand-rolled viewport; that is a separate ticket.
- The document explorer landing in the same Knowledge page (VS-265).
