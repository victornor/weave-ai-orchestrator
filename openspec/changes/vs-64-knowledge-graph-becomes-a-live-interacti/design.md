## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **The data is small but not tiny.** `knowledge.graph()` in
  `packages/core/src/knowledge/service.ts` returns every `knowledge_files` row visible to the
  selected project plus the resolved `knowledge_links` between them. In this workspace that
  is tens of nodes; the acceptance target is 200 nodes and 600 edges.
- **`packages/ui` has no graph library and almost no runtime deps** — React, the router and
  react-query. Anything added is paid for by every page unless it is code-split.
- **Tests are jsdom.** There is no layout, no `Element.scrollTo`, no real hit-testing, and
  `requestAnimationFrame` is faked. Anything whose correctness lives inside a DOM event
  behaviour is effectively untestable here; anything expressed as a pure function is cheap to
  test. The repo's KB already records this for `useStickToBottom` and the composer autosize.
- **Theme is CSS custom properties** (`var(--accent)`, `var(--line-3)`, the status tokens),
  so anything that paints into a canvas loses the theme unless the tokens are read back out.
- **DESIGN-CONTRACT §7.4** fixes the phone rendering as the neighbour list.

## Goals / Non-Goals

**Goals:**

- Keep the simulation, the viewport and the filter model as pure, unit-testable modules; keep
  the React component thin enough that jsdom's missing layout does not block coverage.
- One small dependency, in a lazily-loaded chunk.
- Sixty frames a second at the acceptance size, which means React does not re-render per tick.

**Non-Goals:**

- No WebGL, no worker thread. Both are reachable later behind the same module boundary if the
  graph ever outgrows 200 nodes; neither is needed at this size.
- No change to `GET /knowledge/graph` or to `packages/core`. The renderer works with what the
  API already returns.
- No new design tokens. The palette stays the existing accent and status hues.

## Decisions

### Renderer: `d3-force` for the layout, hand-written pointer handling, SVG for the paint

**Chosen.** `d3-force` (MIT, 3.0.0) supplies the simulation — `forceManyBody`,
`forceLink`, `forceCenter`, `forceCollide` and, for the clusters, `forceX`/`forceY` per
group — plus the alpha model that makes "keeps settling, reheats on disturbance" a property
of the library rather than something to invent. It pulls only `d3-quadtree`, `d3-timer`,
`d3-dispatch` and `d3-binarytree`: about 9 kB gzipped for the set. Barnes–Hut in
`forceManyBody` is what makes 200 nodes affordable; the current hand-written layout is O(n²)
per iteration and is already the reason it runs 260 iterations once and stops.

Zoom, pan and drag are **not** `d3-zoom`/`d3-drag`. Those pull in `d3-selection` (the largest
d3 module here), take over the element's event handling in a way that fights React, and are
close to untestable under jsdom because they depend on real geometry and event dispatch.
Instead: a `ViewportTransform` value (`{ k, x, y }`) plus pure functions —
`zoomAround(transform, clientPoint, factor)`, `panBy`, `fitTo(bounds, size)`,
`toGraph(transform, clientPoint)` — driven by React `onPointerDown/Move/Up` with pointer
capture. The Pointer Events API gives mouse, pen and touch through one code path, and two
simultaneous pointers is all a pinch is. The maths is fully unit-testable; only the event
plumbing is not.

Paint is **SVG**, not canvas: it keeps the CSS custom properties working for theming, keeps
hit-testing and focus/keyboard handling for free, and keeps the nodes queryable from tests.
At 200 nodes and 600 edges SVG is comfortable provided the browser is not asked to
re-create elements each frame — see the next decision.

*Alternatives considered.* `react-force-graph` wraps `three.js` or a canvas renderer and
brings a dependency tree an order of magnitude larger, with the theme problem above.
`sigma.js` + `graphology` is WebGL: fast, but heavier, harder to theme from tokens and
essentially untestable in jsdom. Keeping the hand-written layout and only adding interaction
was considered and rejected: the O(n²) loop and the absence of an alpha/reheat model are
exactly what "live" needs, and re-implementing Barnes–Hut is not a good use of the change.

### React renders structure; the tick writes transforms

React renders one `<g>` per node and one `<path>` per edge, keyed by node id, and never
re-renders them on a tick. The simulation's `tick` handler writes `transform` on each node's
group and `d` on each edge path directly through a ref map. Positions therefore live in the
simulation's node objects, which are the single source of truth; React state holds only what
changes rarely — selection, hover, search text, hidden groups, pinned ids, the zoom bucket
for label detail.

This is the difference between 60 fps and a re-render storm at 200 nodes, and it is why the
component is thin: the interesting logic is in the modules below, not in JSX.

### Module layout

Under `packages/ui/src/lib/graph/`:

| Module | What it owns | Testable in jsdom |
|---|---|---|
| `model.ts` | `GraphModel`: adjacency, degree, group of a node, reciprocal-pair collapse into drawable edges, neighbour lookup | yes, pure |
| `simulation.ts` | building the `d3-force` simulation from a `GraphModel`; `reconcile(previous, next)` that carries positions, velocities and pins across a refetch and seeds new nodes at their neighbours' centroid; `settle()` for reduced motion | yes, pure apart from the timer |
| `viewport.ts` | `ViewportTransform` and the pure zoom/pan/fit/convert functions, with the zoom bounds and the label-detail thresholds | yes, pure |
| `filters.ts` | search matching, hidden groups, the visible node/edge sets, and the derived "is dimmed" decision for a hover or selection | yes, pure |
| `hull.ts` | convex hull (monotone chain) plus padding, as the cluster region path | yes, pure |

`packages/ui/src/routes/KnowledgeGraph.tsx` becomes the component that wires these to the
DOM, plus `GraphDetailPanel` and `GraphNeighbourList` (the phone rendering) as siblings.

`layoutGraph` is deleted. It is exported today but imported by nothing outside its own
module.

### Refetch reconciliation

`reconcile` keys on node id (the knowledge path). Surviving nodes keep `x`, `y`, `vx`, `vy`,
`fx`, `fy`. New nodes are placed at the centroid of whichever of their neighbours already
have positions, jittered, and at the centre when they have none. Removed nodes are dropped.
The simulation's nodes and links are replaced and `alpha` is set to a warm value
(~0.3) rather than 1, so the graph adjusts rather than re-forming.

Pins are `fx`/`fy` on the simulation node, held in a `Set<string>` of pinned ids in React
state so the reconciler and the panel agree on them.

### Clusters

Group membership is `projectSlug ?? scope`, exactly as today, so the legend and the colours
do not change meaning. Clustering is a weak `forceX`/`forceY` per group towards that group's
running centroid — enough to pull a project's pages together without overriding the link
forces. The drawn region is the convex hull of the group's node positions, padded and
rounded, recomputed on the same tick as the node transforms and written as a path `d`.
A group of fewer than two visible nodes gets no hull.

### Reduced motion

`window.matchMedia('(prefers-reduced-motion: reduce)')`, read once per mount and watched, as
`stickToBottom.ts` already does. When reduced: never call `simulation.restart()`; instead
call `settle()`, which is `simulation.tick(n)` in a loop followed by one synchronous write of
every transform. Drag, filter, pin and refetch all route through the same `settle()` call, so
each interaction produces one repositioning with no frames in between. `fit` and `reset`
write the transform in one step rather than easing it.

### Code splitting

`GraphPanel` in `Knowledge.tsx` becomes `React.lazy(() => import('./KnowledgeGraph'))` inside
a `<Suspense fallback={<SkeletonRows/>}>`. This is the app's first lazy boundary; Vite emits
the chunk automatically and `d3-force` lands in it because nothing else imports it. The
bundle numbers before and after go in the PR.

`knowledge.test.tsx` renders `KnowledgeRoute` and clicks through its tabs; it does not open
the Graph tab today, so the lazy boundary should not disturb it — the task list carries a
check for that rather than an assumption.

### Phone

The breakpoint decides the default view, and a control switches between them; both render
from the same `GraphModel`, so the neighbour list is a projection, not a second data path.
The canvas honours touch because the pointer handlers are pointer-type agnostic and the SVG
carries `touch-action: none` so the browser does not steal the gesture.

## Risks / Trade-offs

- **SVG at 200 nodes / 600 edges could stutter on a weak machine** → the per-tick work is
  attribute writes on existing elements, no allocation and no React; if it is not enough, the
  module boundary above lets a canvas painter replace only the paint step. Measured against
  a generated 200/600 graph before the PR.
- **jsdom cannot exercise the gestures** → the arithmetic (zoom about a point, fit, pinch
  scale from two pointers) is in `viewport.ts` and is unit-tested; the pointer plumbing is
  covered by synthetic `pointerdown/move/up` events on the SVG, which jsdom does dispatch,
  with geometry faked on the prototype the way the composer autosize test does it.
- **`d3-force` mutates the node objects it is given** → the simulation's nodes are owned by
  `simulation.ts` and never handed to React as state; the component reads them only inside
  the tick handler and inside imperative handlers.
- **The phone tension with DESIGN-CONTRACT §7.4** → the contract's neighbour list stays the
  phone default; the canvas is opt-in. If the workspace owner would rather the phone open on
  the canvas, that is a one-line default and a note in the contract, and it is called out
  here so the plan approval can settle it.
- **A new lazy boundary is a new failure mode** (a chunk that fails to load shows the
  fallback forever) → the Suspense fallback is the existing skeleton and an error boundary is
  not introduced by this change; a failed chunk behaves as a failed page load does today.

## Migration Plan

None. This is a web-app change with no schema, no API and no config. It ships in the bundle
the daemon serves, so it arrives with the human's `conductor daemon upgrade` after the merge.
Rollback is the previous release.
