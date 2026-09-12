## Context

See `proposal.md` for the diagnosis: `KnowledgeGraph.tsx` (807 lines) drives `@xyflow/react`, a
DOM node-editor, by pushing `d3-force` tick output into React Flow's node state every frame, and
fakes edges/cluster hulls as invisible 1×1 React Flow nodes because React Flow's real edge system
never draws anything touching a node with no `<Handle>` (documented in [[react-flow-in-packages-ui]]
from VS-267, confirmed against a real browser render). `packages/ui/src/lib/graph/{model,filters,
viewport}.ts` are already pure and rendering-agnostic; `simulation.ts` (509 lines) and `hull.ts` (65
lines) are the modules whose whole reason to exist is feeding that DOM-node approach.

`lib/graph/viewport.ts` is not React-Flow-specific despite living next to the graph code: it is a
hand-rolled, dependency-free viewport-transform module (`ViewportTransform { k, x, y }` plus pure
`zoomAround`/`panBy`/`fitTo`/etc.) that `MapCanvas.tsx` (the separate, unrelated global Map route)
already imports directly for its own hand-rolled SVG+pointer renderer. It stays untouched.

## Goals / Non-Goals

**Goals:**
- Canvas-rendered, continuously force-simulated graph with pan/zoom/drag supplied by the rendering
  library rather than hand-built.
- Preserve every behavioural requirement of `knowledge/graph-exploration` except the three named in
  the proposal as changing (node shape, cluster rendering, toolbar controls).
- `KnowledgeGraph.tsx` shrinks well below 807 lines; no `lib/graph/*` module is left unused.
- Keep the graph's colours, labels and states on the app's existing design tokens.

**Non-Goals:**
- The knowledge explorer (separate ticket) and the global Map route (untouched, `viewport.ts` is
  its only intersection with this change) are out of scope.
- 3D, WebGL, or any rendering technology beyond 2D canvas — Obsidian's own graph view, which this
  ticket asks to match, is 2D.
- A general-purpose graph library abstraction. One library, used directly.

## Decisions

### 1. `react-force-graph-2d` as the renderer

Confirmed against the registry: `react-force-graph-2d@1.29.1` declares `peerDependencies: { react:
"*" }` (no upper bound problem with React 19, already in use here) and wraps `force-graph@1.51.x`,
which bundles its own `d3-force-3d`, `d3-zoom` and `d3-drag` and owns wheel/pinch/pan/drag on the
canvas element itself, exactly the built-in behaviour the ticket asks for instead of hand-building
it again. Its customization surface (`nodeCanvasObject`, `linkCanvasObject`, `nodePointerAreaPaint`,
`d3Force(name, force)` to add/replace forces, `onNodeHover`/`onNodeClick`/`onNodeDrag`/`onZoom`) is
exactly what drawing app-themed circles, labels and highlight state, and adding the existing
project-cluster pull force, needs.

**Alternatives considered:**
- Plain `force-graph` (no React wrapper): saves one dependency layer but means hand-writing the
  React lifecycle (mount/unmount/prop-diffing) `react-force-graph-2d` already provides; no material
  benefit for a single-consumer route.
- `d3-force` directly on a hand-rolled `<canvas>`: this project already tried the hand-rolled-engine
  path once (`simulation.ts`) and it is exactly the 509 lines this change deletes. Rebuilding
  wheel/pinch/pan/drag hit-testing by hand a second time, on canvas this time, reproduces the same
  amount of hand-built plumbing the ticket is asking to stop paying for.
- `sigma.js` / `cytoscape`: both are heavier, WebGL-capable graph-visualization frameworks aimed at
  much larger graphs and richer graph algorithms than this page needs (tens to a few hundred nodes).
  Their canvas/2D customization surfaces are less direct for "draw exactly this app's circles and
  labels" than `force-graph`'s callback-per-primitive model.

### 2. Node shape: circle sized by degree, filled by group colour

Obsidian's graph — the explicit reference — draws small circles, not labeled rectangles. Captain's
"just fucking nodes and a network" complaint is partly a direct reaction to the current chip shape.
The existing `chipSize()`/rectangle-chip requirement in the spec (`Nodes and edges carry their
meaning`) is itself part of what forced the React-Flow-as-node-editor architecture — a DOM node was
needed to lay out variable-width title text inside a bordered rectangle. A circle has no such
layout need: canvas text is drawn as a separate primitive next to it. This is why the spec delta
changes that requirement rather than the renderer working around it.

Radius formula: `radius = BASE + Math.sqrt(degree) * SCALE`, clamped to a max so a hub with many
links does not dwarf the graph (same intent as the old `chipSize`'s degree-based growth, ported to
one dimension). Hub vs. document distinguished by a slightly larger base radius and a heavier
stroke, matching "distinguishable by size or weight" in the modified spec.

### 3. Cluster hulls dropped in favour of per-node group colour

`hull.ts`'s convex-hull-of-dilated-points recomputation, every tick, for every group, is exactly the
kind of machinery the ticket calls out by name ("If a colour per group delivers the same
understanding with a fraction of the machinery, propose that"). A filled circle per node already
carries its group's colour (the current chip already draws this as an accent stripe); making the
whole circle that colour, plus the existing clustering pull force keeping a group's nodes spatially
near each other, delivers the same "which pages belong together" read Obsidian itself uses — Obsidian
does not draw cluster boundaries either, it colours nodes by tag/folder and lets proximity do the
rest. `hull.ts` and its call sites are deleted; the spec's clustering requirement is retitled from
hull-drawing to colour-and-proximity in the delta.

The existing group-centroid pull (`clusterForce` in `simulation.ts`) is kept as behaviour, ported to
a small standalone force function registered via `graphRef.current.d3Force('cluster', clusterForce(
STRENGTH))` — `force-graph` exposes its underlying `d3-force-3d` simulation for exactly this kind of
custom-force registration, so this is a straight port of the existing tested function, not a
rewrite of its logic.

### 4. Toolbar buttons removed; default zoom replaces "Reset"

The ticket is explicit that captain has complained about Zoom in/Zoom out/Fit/Reset before, and
acceptance criterion 2 asks for a page usable by wheel-zoom and background-drag alone. The current
spec requires all four controls unconditionally; the modified requirement drops that clause and
keeps only the behaviours that do not need a button: bounded wheel/pinch zoom, background/pinch pan,
and a readable default zoom at open (which is what "Reset" used to return to). A reader can still
reach any zoom or pan state with the wheel and a drag; nothing the four buttons did is otherwise
unreachable.

### 5. `simulation.ts` and `hull.ts` deleted; `model.ts`, `filters.ts`, `viewport.ts` unchanged

`model.ts` (API response → `GraphModel`) and `filters.ts` (search/hide/highlight over a
`GraphModel`) never referred to React Flow or to `d3-force`'s node shape; they operate on the
model's own `GraphNode`/`GraphEdge` types and stay as-is, with their existing unit tests untouched.
`viewport.ts` stays for `MapCanvas.tsx`, per the ticket's explicit instruction to check before
deleting anything the Map route shares.

### 6. Testing strategy given canvas + jsdom

jsdom in this repo has no real 2D canvas context (no `canvas` native package installed), so
`react-force-graph-2d` cannot be mounted and asserted against via DOM queries the way
`@xyflow/react`'s DOM output was in the current 418-line `knowledgeGraph.test.tsx` — and even where
mounting is possible, `force-graph` drives pan/zoom/drag through `d3-zoom`/`d3-drag`, which
[[react-flow-in-packages-ui]] already found cannot be driven from this project's jsdom + Testing
Library stack (real `mousedown`/`event.view` semantics `d3-drag` needs). This is not a
`react-force-graph-2d`-specific gap; the same limitation already exists for React Flow's own
`d3-drag`-based node drag.

Per the workspace convention ("When a harness cannot verify something, test the underlying model as
a pure function and verify the rest visually — do not shrink the feature to fit the harness"):

- Unit-test, as pure functions with no rendering: the model→drawing adapter (degree→radius,
  group→colour, `labelDetail(zoom)`, the ported `clusterForce`, the circle-boundary edge-trim math,
  and the label-suppression scoring) — the same granularity `simulation.test.ts` already tests
  `chipSize`/`rectIntersection`/`suppressedLabels` at today.
- Unit-test the canvas paint callbacks (`nodeCanvasObject`, `linkCanvasObject`) by calling them
  directly against a small recording fake implementing the `CanvasRenderingContext2D` methods they
  use (`arc`, `fill`, `stroke`, `fillText`, …) and asserting on the recorded calls — a standard
  pattern for canvas code, and independent of jsdom's real canvas support.
- Mock `react-force-graph-2d` itself (as the current suite already mocks `../api/hooks`) for
  component-level tests of `KnowledgeGraphView`'s own logic: what nodes/links/props it computes and
  passes down for a given search/hide/hover/select state — without needing the real canvas to mount.
- Verify pan, zoom, drag and hover interaction by hand against the running dev server, screenshotted
  via [[ui-screenshot-harness]] (zoomed out, zoomed in with labels, one node hovered), the same
  evidence the ticket asks the delivery report to carry. This is real-browser verification, not a
  gap left untested — it is the only way this class of interaction has ever been verifiable in this
  repo, React Flow included.

### 7. Dependency cleanup

Remove `@xyflow/react` (and its `dist/style.css` import) from `packages/ui/package.json` — confirmed
the only importer is this route (plus its test file and one `setup.ts` shim, both removed alongside
it). Remove `d3-force` and `@types/d3-force` — `simulation.ts` was their only direct importer;
`force-graph` carries its own bundled simulation engine (`d3-force-3d`) as a transitive dependency,
so nothing in `packages/ui` imports `d3-force` directly once `simulation.ts` is gone. Add
`react-force-graph-2d`. Remove the `DOMMatrixReadOnly` shim from `packages/ui/src/test/setup.ts`
(added solely for `@xyflow/react`'s `updateNodeInternals`; dead once nothing imports React Flow).

## Risks / Trade-offs

- **[Risk] Canvas text rendering may look subtly different from the app's DOM/CSS type rendering**
  (no CSS font shorthand, no subpixel antialiasing guarantees across browsers) → Mitigation: read
  the font family/size/colour from the same CSS custom properties (`getComputedStyle` on the graph's
  own container, done once per size/theme change, not per node) so the graph still tracks a theme
  switch and the design tokens, and confirm via the required screenshots that text is legible at the
  labelled zoom thresholds.
- **[Risk] `force-graph`'s internal `d3-zoom`/`d3-drag` may not expose every hook the current
  component reads (e.g. current zoom level for `labelDetail`)** → Mitigation: `react-force-graph-2d`
  exposes `onZoom`/`onZoomEnd` callbacks reporting `{ k, x, y }` on every viewport change; confirmed
  in its published type definitions before committing to this design.
- **[Risk] The ported `clusterForce` interacting with `force-graph`'s own default forces
  (charge/link/center) differently than it did inside the bespoke `simulation.ts` sim** → Mitigation:
  `force-graph` exposes `d3Force('charge', ...)`/`d3Force('link', ...)` to tune or replace the
  defaults exactly as `simulation.ts` already configures `forceManyBody`/`forceLink`; port the same
  tuned parameters first and adjust only if the settled layout visibly differs, checked against the
  same "workspace-scale legibility" scenario the spec already requires.
- **[Trade-off] Losing the current suite's DOM-level interaction assertions** (documented as
  unavoidable in Decision 6) in exchange for pure-function + mocked-component + real-browser
  coverage. This trades one kind of test confidence for another rather than reducing overall
  coverage — see Decision 6 for why the DOM-level kind was never assertable for pan/zoom/drag even
  under the previous renderer.

## Migration Plan

1. Add `react-force-graph-2d`; remove `@xyflow/react`, `d3-force`, `@types/d3-force` in the same
   commit that stops importing them (no dual-renderer intermediate state — the acceptance criteria
   require `@xyflow/react` gone, not deprecated).
2. Port `clusterForce` out of `simulation.ts` into a small standalone module (or inline in the
   route) before deleting `simulation.ts`, so the group-clustering behaviour is not silently lost.
3. Rewrite `KnowledgeGraph.tsx` against `react-force-graph-2d`, reusing `model.ts`/`filters.ts`
   unchanged.
4. Delete `simulation.ts`, `hull.ts`, and their now-obsolete tests; add the new pure-function and
   canvas-callback tests described in Decision 6.
5. Remove the `DOMMatrixReadOnly` shim from `test/setup.ts`.
6. Apply the spec delta to `openspec/specs/knowledge/graph-exploration/spec.md` (via archive, after
   merge — not run by this worker).
7. Manual verification against the running dev server with real workspace data; screenshots for the
   delivery report.

No data migration, no API change, no rollback concerns beyond a normal revert — this is a
client-side rendering swap behind one route.

## Open Questions

None that would change the specs, the approach, or the task breakdown. Exact tuning constants
(radius base/scale, force strengths) are implementation detail to be checked against the
"workspace-scale legibility" and "default layout is spread out" scenarios during apply, not a
decision this design needs to pre-commit to a number for.
