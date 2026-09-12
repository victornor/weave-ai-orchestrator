## Why

The knowledge graph (`packages/ui/src/routes/KnowledgeGraph.tsx`) is built on `@xyflow/react`, a
DOM-based node-editor library for flowcharts. Every node is a real DOM element measured and
positioned by React on every `d3-force` tick; edges and cluster hulls have to be smuggled in as
fake 1×1-sized React Flow "nodes" because the library's own edge system refuses to draw anything
touching a node with no `<Handle>` (confirmed in [[react-flow-in-packages-ui]] against a real
browser render, not guessed from source). The result reads as a diagram editor that has been
shaken, not a live network — which is exactly what captain rejected it for a third time over.
Obsidian's graph view, which captain asked for by name, is a canvas-rendered force-directed graph
with no DOM per node. That is a different rendering foundation, not a tuning problem on the
current one.

## What Changes

- Replace `@xyflow/react` with `react-force-graph-2d` (canvas rendering, `d3-force` layout, and
  built-in wheel-zoom/pinch/pan/drag) as the sole renderer for the knowledge graph route.
  **BREAKING** (internal): removes the `@xyflow/react` dependency from `packages/ui` once nothing
  else needs it (confirmed: only this route imports it).
- Delete `lib/graph/simulation.ts` (its rectangular-chip `d3-force` wrapper and hand-rolled
  rect-collision/rect-edge-trim math are specific to DOM chip nodes and have no equivalent need
  once nodes are canvas-drawn circles) and `lib/graph/hull.ts` (convex-hull cluster regions). Keep
  `lib/graph/model.ts` and `lib/graph/filters.ts` unchanged — both are pure, rendering-agnostic and
  already unit-tested. Keep `lib/graph/viewport.ts`: it is **not** React-Flow-specific pan/zoom
  math, it is shared with `MapCanvas.tsx` (the global Map route), which has its own hand-rolled SVG
  renderer and depends on it directly.
- Redraw a node as a circle sized by its degree and filled with its group's colour (Obsidian's own
  convention), instead of a labeled rectangular chip with a colour accent stripe. Titles are drawn
  as canvas text near the node, governed by the existing zoom-based label-detail rule.
- Drop the convex-hull cluster regions in favour of the per-node group colour alone as the
  clustering cue: a group is legible from its nodes' shared colour without a translucent boundary
  drawn and recomputed every tick. This removes `hull.ts` and its tick cost entirely.
- Drop the explicit Zoom in / Zoom out / Fit / Reset toolbar buttons. Scroll-wheel zoom, pinch zoom
  and background drag-to-pan (all built into `react-force-graph-2d`) are sufficient to use the page
  without them, and captain has named these specific buttons as something the page should not need.
  The graph still opens at a readable default zoom (replacing what the "Reset" button did).
- `KnowledgeGraph.tsx` shrinks from 807 lines to a thin component: build the model, feed
  `react-force-graph-2d` nodes/links derived from it, and supply canvas paint callbacks for circle
  fill, label-detail text and hover/selection dimming.

## Capabilities

### New Capabilities

(none — this changes how an existing capability is delivered, not what it does)

### Modified Capabilities

- `knowledge/graph-exploration`: node shape changes from a labeled rectangular chip to a coloured
  circle sized by degree (affects "Nodes and edges carry their meaning" and the chip-specific
  language in "The default layout is spread out"); cluster regions (convex hulls) are replaced by
  per-node group colour ("Groups can be filtered and are drawn as clusters"); the mandatory
  zoom-in/zoom-out/fit/reset toolbar controls are removed in favour of wheel/pinch/drag alone plus
  an automatic readable default zoom ("The viewport can be zoomed and panned"). Every other
  requirement in this capability (live simulation, refetch animation, drag/pin, label detail by
  zoom, hover neighbourhood, detail panel, search, phone list, reduced motion, responsiveness at
  scale, theming, stub-hub omission, workspace-scope edges, project scoping, own-frame
  measurement, workspace-scale legibility) is unchanged in behaviour and is being made *actually
  true* by the new renderer, not altered.

## Impact

- `packages/ui/package.json`: remove `@xyflow/react` and its `dist/style.css` import; remove
  `d3-force` and `@types/d3-force` (only `lib/graph/simulation.ts` imported them; `d3-force` ships
  transitively inside `force-graph`, which owns its own simulation instance internally — nothing in
  this package will import `d3-force` directly after this change). Add `react-force-graph-2d`.
- `packages/ui/src/routes/KnowledgeGraph.tsx`: rewritten, substantially smaller.
- `packages/ui/src/lib/graph/simulation.ts`, `hull.ts`: deleted, with their test files
  (`simulation.test.ts`, and any hull-specific assertions inside `graphFilters.test.tsx` /
  `knowledgeGraph.test.tsx`) replaced or removed accordingly.
- `packages/ui/src/lib/graph/model.ts`, `filters.ts`, `viewport.ts`: unchanged. `viewport.ts` stays
  because `packages/ui/src/routes/MapCanvas.tsx` imports it directly for its own independent SVG
  renderer; this change does not touch the Map route.
- `packages/ui/src/test/setup.ts`: the `DOMMatrixReadOnly` shim, added only for
  `@xyflow/react`'s internal `updateNodeInternals`, becomes dead and is removed once nothing else
  needs it.
- `packages/ui/src/test/knowledgeGraph.test.tsx` (418 lines): current assertions query React Flow's
  DOM output (`.react-flow__node`, `data-chip`, `svg path[fill-opacity]` for hulls) — none of that
  exists once nodes are painted to a `<canvas>`. jsdom has no real 2D canvas context in this repo
  (no `canvas` native package installed), so `react-force-graph-2d` cannot be mounted and asserted
  against the way `@xyflow/react` was. Tests are restructured per this project's own convention
  ([[react-flow-in-packages-ui]], and the workspace-wide rule "test the underlying model as a pure
  function and verify the rest visually"): pure unit tests for the model→canvas-node adapter
  (degree→radius, group→colour, zoom→label-detail) and for the canvas paint callbacks against a
  recording fake `CanvasRenderingContext2D`, plus a real-browser check via the existing
  [[ui-screenshot-harness]] for pan/zoom/drag/hover, which cannot be driven under jsdom regardless
  of renderer (`d3-drag`/`d3-zoom`, which `force-graph` itself uses internally, have the same jsdom
  limitation already documented for React Flow's own `d3-drag` use).
- `openspec/specs/knowledge/graph-exploration/spec.md`: three requirements modified as above.
