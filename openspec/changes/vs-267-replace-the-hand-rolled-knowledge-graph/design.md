## Context

See `proposal.md` for the why and VS-264's report (`ac_ticket_document_get VS-264 report`) for the
full diagnosis and library evaluation. Relevant current state, read directly from the source for
this design:

- `KnowledgeGraph.tsx` (741 lines) owns a `useEffect`-attached non-passive wheel listener
  (`el.addEventListener('wheel', onWheel, { passive: false })`), manual pointer-event drag/pinch
  handling, and a `draw()` callback that writes node/edge/hull geometry straight onto SVG elements
  through ref maps on every simulation tick — the "no re-render on tick" technique that keeps 200
  nodes at 60fps.
- `lib/graph/simulation.ts`'s `nodeRadius()` is `Math.max(width, height) / 2` of `chipSize()`, used
  both by `edgePath()` (trim) and `forceCollide()` (separation). `chipsOverlap()` already implements
  the correct axis-aligned rectangle test but its only caller is `suppressedLabels()`, which fades a
  label rather than resolving the overlap.
- `lib/graph/viewport.ts` is pure transform arithmetic (`ViewportTransform { k, x, y }`,
  `zoomAround`/`panBy`/`fitTo`/`toSvg`/etc.), deliberately not `d3-zoom`, because — per its own
  header comment — "that module owns the element's event handling, which fights React for it." This
  file is reused unchanged by `MapCanvas.tsx` (VS-192, the Instance Map) and is **not** touched by
  this change.
- `lib/graph/{model,filters,hull}.ts` are pure, DOM-free, and already unit-tested; nothing about
  switching the renderer requires changing their contracts.
- `packages/ui/package.json` depends on `d3-force` today; `@xyflow/react` is not yet a dependency.
- Design tokens (`index.css`) already used by the chip: `--bg-1`, `--line-2`/`--line-3`, `--text-1`,
  `--accent`, `--status-*`. No new token is introduced by this change.

## Goals / Non-Goals

**Goals:**
- Scroll-wheel zoom works from the moment the canvas mounts, without fighting page scroll, and
  without needing the Zoom in/Zoom out buttons.
- An edge trims to the target chip's real rectangle boundary, from any angle.
- Collision is rectangle-aware: the settled layout has no two overlapping chips, verified by
  `chipsOverlap` rather than only by the label-suppression backstop.
- `model.ts`, `filters.ts`, `hull.ts`, and the tuned force configuration in `simulation.ts` survive
  with no behavioural change to what they compute.
- Light/dark both keep working from existing tokens; no hardcoded colour.

**Non-Goals:**
- Migrating `MapCanvas.tsx` to React Flow, or touching `lib/graph/viewport.ts`'s contract —
  `MapCanvas.tsx` keeps using it exactly as today.
- Changing what counts as a node or edge, or the `GET /knowledge/graph` API — this is a
  rendering/interaction change only.
- A generic reusable "React Flow + d3-force" pattern for other graphs.

## Decisions

### 1. `@xyflow/react`, not a further hand-rolled iteration

Confirmed rather than re-litigated (VS-264's evaluation of seven libraries): React Flow is the only
candidate that both owns wheel/pan/pinch from mount (fixing root cause 1) and renders nodes as real
React components, so the existing Tailwind/CSS-token chip styling carries over instead of being
reimplemented against a `<canvas>`. `d3-force` is not replaced — React Flow has no built-in force
layout by design, and pairing it with an external one via node-position updates each tick is its own
documented pattern, not a workaround.

New dependency: `@xyflow/react` (MIT, peer `react >=17`, confirmed React 19-compatible). `d3-force`
stays as-is.

### 2. Layout stays `d3-force`; positions are pushed into React Flow's node state per tick

`createSimulation()` (`simulation.ts`) is unchanged in its public shape — it still owns `SimNode[]`,
still runs `d3-force`, still exposes `onTick`/`pin`/`drag`/`settle`. What changes is who reads its
output:

- The component keeps one `SimNode[]` (from `sim.nodes()`) as the source of truth, exactly as today.
- On each `onTick`, instead of writing `transform` attributes onto ref-mapped SVG elements, the
  component updates React Flow's node array with the new `{ x, y }` positions (React Flow's
  documented external-layout pattern: `useNodesState` seeded once, then `setNodes` from the
  simulation's tick callback, translating each `SimNode` into `{ id, position: { x, y }, data }`).

  **Correction, made explicit rather than left implicit:** this does *not* keep today's "zero React
  renders per tick" property. Today's `nodeRefs.current.get(n.id)?.setAttribute(...)` is a direct DOM
  write with no `setState` involved — during a tick, React never runs. On a force-simulation tick
  *every* node's position changes, by definition, so calling `setNodes` on every tick re-renders
  every node's component, every tick — the technique is traded away, not preserved. Whether that
  trade is acceptable is exactly the open question task 1.3 below measures before the rewrite
  proceeds, not a property asserted here in place of measuring it. If it is not acceptable, the
  fallback is to drive node positions imperatively — writing the `transform` CSS directly onto each
  node's DOM element (React Flow exposes this via its internal store / `useReactFlow().getNode`
  element refs, the same shape as today's ref map) outside React's render cycle, and reserving
  `setNodes` for state changes that are genuinely occasional (selection, pin, filter) — rather than
  abandoning React Flow.
- Reduced motion keeps calling `sim.settle()` once and writing the settled positions in a single
  `setNodes` call, exactly mirroring today's synchronous-pass behaviour.
- Pin/drag: a React Flow node drag calls `sim.drag(id, x, y)` / `sim.endDrag(id)` exactly as the
  current pointer handlers do today, via React Flow's `onNodeDrag`/`onNodeDragStop` callbacks instead
  of the hand-rolled `onPointerMove` gesture tracking. Node dragging no longer needs the
  click-vs-drag slop threshold to be reimplemented — React Flow's own `onNodeClick` only fires when a
  drag did not occur past its own threshold, so `CLICK_SLOP_PX`'s job is now the library's.

### 3. Viewport/zoom/pan/fit is React Flow's, not `lib/graph/viewport.ts`

`KnowledgeGraph.tsx` stops importing `lib/graph/viewport.ts` entirely. React Flow's own `useReactFlow()`
hook supplies `zoomIn()`, `zoomOut()`, `fitView()`, and `setViewport()` (for Reset, computed the same
way `defaultView()` does today: fit-to-bounds, floored at `DEFAULT_ZOOM`). Panning and wheel/pinch
zoom are React Flow's native canvas behaviour, owned from mount — this is the direct fix for root
cause 1. `MIN_ZOOM`/`MAX_ZOOM`/`DEFAULT_ZOOM` become React Flow's `minZoom`/`maxZoom`/`defaultViewport`
props; the numeric values carry over unchanged so the zoom envelope does not shift as a side effect.

Label detail-by-zoom (`labelDetail()`, `LABEL_TRUNCATED_ZOOM`/`LABEL_FULL_ZOOM`) is unaffected — it is
pure arithmetic over the current `k`, read from React Flow's viewport state (`useViewport()` or the
zoom value already available on each `onMove`) instead of from `viewRef.current.k`.

`lib/graph/viewport.ts` is left in the tree, untouched, for `MapCanvas.tsx`. Its exports that only
`KnowledgeGraph.tsx` used (if any remain unused after this change — expected candidates:
`zoomAround`, `panBy`, `pinchScale`, `midpoint`, `toSvg`, `toGraph`, `ZOOM_STEP`, `IDENTITY`, since
`MapCanvas.tsx` imports its own overlapping-but-not-identical set) are removed specifically, verified
by grepping `MapCanvas.tsx`'s actual import list before deleting anything — not by assuming symmetry
between the two consumers.

### 4. Edge trimming: rectangle intersection, not a circle

New pure function, colocated with the existing chip-geometry code in `simulation.ts` (same module
`chipSize`/`nodeRadius`/`chipsOverlap` already live in, so the geometry stays in one place):

```ts
/** Where the line from a chip's centre toward `(tx, ty)` crosses that chip's rectangle boundary. */
function rectIntersection(cx: number, cy: number, halfW: number, halfH: number, tx: number, ty: number): Point {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // Scale factor to reach the rectangle boundary along whichever axis is hit first.
  const scale = Math.min(
    dx !== 0 ? halfW / Math.abs(dx) : Infinity,
    dy !== 0 ? halfH / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}
```

`edgePath()` calls this once per endpoint — using each chip's own `chipSize()` half-width/half-height
and the *other* chip's centre as the target direction — instead of subtracting `link.source.radius`/
`link.target.radius` (the circle) along the unit vector. A small constant gap (matching today's
`gap = link.directed ? 4 : 1`) is still added along the same direction after the rectangle
intersection, so an arrowhead does not visually touch the border.

This directly fixes the ~84-unit gap VS-264 measured for a near-vertical edge into a wide, short
chip: `rectIntersection` returns the real half-height boundary point, not a distance derived from
the chip's longer dimension.

Unit tests (extending `simulation.test.ts`): a horizontal approach trims at `halfW`, a vertical
approach trims at `halfH`, and a diagonal approach trims at whichever axis the ray reaches first —
covering the acceptance criterion's near-vertical case explicitly, plus the cases a circle
approximation happens to get right (so a regression toward a circle would still be caught here even
if only the near-vertical case were asserted).

### 5. Collision: a rectangle-separation force, replacing `forceCollide`

`forceCollide<SimNode>((d) => d.radius + 20).iterations(4)` (simulation.ts:286) is replaced by a
custom `d3-force`-shaped force, following the same pattern `clusterForce()` already uses in this file
(a closure implementing `(alpha) => void` plus `.initialize`):

```ts
/** Pairwise axis-aligned separation: push two overlapping chips apart along the axis of least
 *  penetration, the same test `chipsOverlap` already runs, but as a correction rather than a check. */
function rectCollide(padding: number, strength: number): Force<SimNode, undefined> {
  let nodes: SimNode[] = [];
  const force = (alpha: number): void => {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!, b = nodes[j]!;
        const wa = chipSize(a), wb = chipSize(b);
        const dx = b.x - a.x, dy = b.y - a.y;
        const overlapX = (wa.width + wb.width) / 2 + padding - Math.abs(dx);
        const overlapY = (wa.height + wb.height) / 2 + padding - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        // Separate along the axis with the smaller penetration — the standard AABB
        // minimum-translation-vector choice — so a mostly-side-by-side pair is pushed
        // apart sideways and a mostly-stacked pair is pushed apart vertically.
        if (overlapX < overlapY) {
          const push = (overlapX / 2) * alpha * strength * (dx < 0 ? -1 : 1) || 0.01;
          a.vx = (a.vx ?? 0) - push; b.vx = (b.vx ?? 0) + push;
        } else {
          const push = (overlapY / 2) * alpha * strength * (dy < 0 ? -1 : 1) || 0.01;
          a.vy = (a.vy ?? 0) - push; b.vy = (b.vy ?? 0) + push;
        }
      }
    }
  };
  force.initialize = (ns: SimNode[]): void => { nodes = ns; };
  return force;
}
```

Same O(n²) cost `suppressedLabels()` already pays every tick at this graph's supported scale (200
nodes, ~40k pairs) — no new complexity class. `padding` and `strength` are tuning constants set
during implementation against the acceptance test (task 2 below): start from values equivalent in
spirit to today's `+20` collide margin and `.iterations(4)`, then adjust until a seeded ~34-node/
5-group graph (the same shape `simulation.test.ts`'s `multiGroupGraph()` already builds) settles with
zero `chipsOverlap` pairs. This is a real tuning step, not a fixed number decided here — call it out
in the PR if the constants land far from today's, since that would say something about how much
tighter rectangle-aware collision needs to be than the circle approximation it replaces.

`nodeRadius()` itself is not deleted: `linkDistance()` and the `radius` field on `SimNode` still use
it for link-distance spacing (a circle is a fine approximation for "how far apart two linked chips'
*centres* should rest," which is a spacing preference, not a boundary check) and for
`suppressedLabels()`'s priority maths, which does not need to change. Only the two call sites where a
circle was standing in for an edge/collision *boundary* — `edgePath()` and the collide force — change.

### 6. `suppressedLabels()`'s narrowed job

With collision genuinely resolving rectangle overlap at rest, `suppressedLabels()` is no longer the
mechanism that hides a permanently-unresolved layout defect — that defect is fixed. It stays as a
one-tick-cheap backstop for the transient case the simulation itself creates on purpose: a drag
target moving through a neighbour's space, or the first few ticks after a reheat, before
`rectCollide` has had time to push the pair apart again. The function's implementation does not
change (same `chipsOverlap` + `labelScore` priority logic); only its doc comment and its role in the
requirement text change to say this plainly, so a future reader does not reinstate it as a substitute
for fixing geometry, the way `suppressedLabels()`'s original comment (before this change) invited.

### 7. Node and edge components

- **Node**: a `KnowledgeChipNode` custom React Flow node type rendering the same visual today's
  `GraphNodeShape` draws (rect + accent stripe + label + pin dot), sized from `chipSize()`. React
  Flow nodes are positioned by the library via CSS transform on a wrapping element; the chip's own
  markup can stay SVG (an inline `<svg>` sized to the chip) or become HTML (`div`/`span` with the
  same Tailwind classes) — implementation picks whichever keeps the existing `data-node`/`data-chip`/
  `data-kind`/`data-dimmed`/`data-pinned` test hooks intact, since `knowledgeGraph.test.tsx` and
  other call sites query them.
- **Edge**: a custom edge type calling `rectIntersection()` for both endpoints (needs each node's
  current position and `chipSize()`, both available from React Flow's node lookup), rendered as an
  SVG `path` with the existing `#ac-graph-arrow` marker for directed edges — the marker definition
  and dimmed/undimmed stroke styling carry over unchanged.
- Hulls: still computed by `hullPath()` from `byGroup` node positions and drawn as an SVG `path`
  layer; React Flow supports arbitrary custom elements in its pane, so this can render as a
  `<svg>` overlay the same way it does today, positioned in graph space via React Flow's own
  coordinate system rather than the hand-rolled `viewport.ts` transform.

### 8. Testing

`@xyflow/react` renders real DOM nodes and reads element geometry (`getBoundingClientRect`) for some
internals; the project's existing `resizeObserver.ts` test helper and jsdom's known layout gaps are
already worked around elsewhere in this codebase (VS-130, the phone-viewport tests). Verify early —
before rewriting the whole test file — that a minimal `<ReactFlow>` mount renders under
`@testing-library/react` + jsdom in this repo's vitest setup, the same way VS-264's real-Chromium
repro was needed to see the actual wheel-ownership bug (jsdom's synthetic `fireEvent.wheel` cannot
prove real browser gesture-ownership either way). If jsdom cannot exercise real wheel/pinch
delivery — expected, since that is exactly the class of thing CDP-vs-jsdom already disagreed about in
VS-264's own repro — assert the geometry (rectangle trim, non-overlap, label suppression, filters,
search, detail panel, phone list) as today's tests already do for everything but the gesture itself,
and note plainly in the PR which part of acceptance criterion 1 (scroll-wheel zoom actually zooming,
not scrolling the page) is verified by unit test versus by the project's `ui-screenshot-harness`
real-browser convention, rather than asserting a unit test proves something jsdom cannot.

## Risks / Trade-offs

- **Bundle size**: `@xyflow/react` brings `d3-zoom`/`d3-drag`/`d3-selection`/Zustand (57KB gzip,
  per VS-264). Accepted per VS-264's recommendation; no lighter candidate solved both root causes.
- **Performance at 200 nodes, during settle and drag specifically.** Per Decision 2's correction:
  driving `setNodes` from every simulation tick re-renders every node's React component every tick —
  today's ref-based approach exists precisely to make that zero. The existing "graph stays responsive
  at 200 nodes/600 edges" requirement is unchanged and must still hold once the simulation is warm
  (settling after open, reheating on a drag or a data change); it matters less at rest, since the
  simulation cools and stops emitting ticks once settled. Task 1.3 measures this against the real
  simulation before the 700-line rewrite proceeds, specifically so this is a finding made on day one
  rather than discovered at the end. If frame rate does not hold, the fallback is the imperative
  DOM-write strategy in Decision 2 (positions written outside React's cycle, `setNodes` reserved for
  occasional state), not a silent cap on the graph's supported size.
- **`viewport.ts` now has two audiences with diverging needs long-term**: `MapCanvas.tsx` keeps its
  own hand-rolled pattern while `KnowledgeGraph.tsx` moves to a library-owned one. This is the
  explicit, ticket-stated non-goal (migrating the Map is separate work), not an oversight — flagged
  here so it is not mistaken for one later.
- **`suppressedLabels()`'s new narrower framing is a documentation change riding along with a real
  behavioural one** (collision now resolves rectangle overlap it previously only masked); if the
  tuned `rectCollide` constants cannot get a realistic graph fully overlap-free at rest (task 2's
  verification), that is a genuine open finding to report, not a reason to quietly widen
  `suppressedLabels()`'s job back to covering for it.
