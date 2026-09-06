## Why

The knowledge graph is the only place a person can see how the workspace's memory hangs
together, and today it is a picture rather than a tool. `KnowledgeGraphView`
(`packages/ui/src/routes/KnowledgeGraph.tsx`) runs 260 iterations of a hand-written force
layout inside a `useMemo`, freezes the result and draws static SVG in a `0 0 100 100`
viewBox. Nothing can be dragged, the view cannot be zoomed or panned, there is no search
and no filter, labels overlap wherever the layout put them, and every refetch of
`useKnowledgeGraph` recomputes the whole layout from a fresh ring of start positions — so
the graph teleports rather than moves. Past a few dozen pages it is unreadable.

The workspace owner asked for the feel of yWorks' interactive knowledge-graph demo: a
simulation that keeps settling, direct manipulation of the nodes, smooth zoom and pan,
neighbourhood highlighting, clustering by group and a detail panel — built on open-source
parts, because yFiles is a commercial SDK.

## What Changes

- **A live simulation.** The one-shot `layoutGraph` is replaced by a `d3-force` simulation
  that runs in the browser, keeps settling, and is *reheated* rather than restarted when the
  graph data changes: nodes that already exist keep their positions and velocities, so a
  refetch animates instead of jumping.
- **Direct manipulation.** A node can be dragged with a mouse or a finger; its neighbours
  re-flow while it moves. Releasing it lets it settle; double-clicking (or the detail
  panel's control) pins it, and a pinned node is drawn with a pin mark and stays where it
  was put until it is unpinned.
- **A viewport.** Wheel and pinch zoom, drag-the-background pan, and *fit* and *reset*
  controls. Zoom drives label detail: no labels far out, truncated labels in the middle,
  full labels close in. The viewport is a pure transform module, not a d3 behaviour — see
  design.
- **Highlighting and a detail panel.** Hovering a node lights it, its direct neighbours and
  the edges between them and dims everything else. Clicking selects it and opens a detail
  panel carrying title, scope or project, token size, degree, the pin toggle and the list of
  linked pages, each of which can be opened or focused. The existing click-to-open behaviour
  survives as that panel's **Open page** action and as the node's double-click.
- **Search, filters and clusters.** A search box matches node titles, dimming and
  un-focusing what does not match and focusing the view on what does; project and scope
  filters hide whole groups; each project's nodes are wrapped in a translucent hull with the
  project's colour, and the legend names the groups and toggles them.
- **Direction where it exists.** `knowledge_links` are directional (`from_path` →
  `to_path`). An edge that exists in one direction is drawn with an arrowhead; a reciprocal
  pair is drawn as one plain line.
- **Phone and reduced motion.** DESIGN-CONTRACT §7.4 makes the phone rendering "selected
  node then its neighbours as a list, one hop at a time"; that stays the default under the
  phone breakpoint, with an explicit toggle into the canvas, which supports touch drag and
  pinch zoom for people who want it. Under `prefers-reduced-motion: reduce` the simulation is
  run to convergence in one synchronous pass and drawn once — no animation frames at all.
- **Code splitting.** The graph panel is loaded with `React.lazy`, so neither the renderer
  nor `d3-force` is in the chunk that every other page pays for.

Not breaking: the graph's data contract (`GET /knowledge/graph`, `KnowledgeGraph` in
`packages/ui/src/api/types.ts`) is untouched, and no daemon code changes.

## Capabilities

### New Capabilities

- `knowledge/graph-exploration`: how a person explores the knowledge graph — the live
  layout and its stability across refreshes, dragging and pinning, the viewport and label
  detail, neighbourhood highlighting, the detail panel, search, filters and clusters, the
  phone rendering, and the reduced-motion behaviour.

### Modified Capabilities

(none — `knowledge/budgets` is about file sizes and is untouched.)

## Impact

- `packages/ui/src/routes/KnowledgeGraph.tsx` — rewritten. `layoutGraph` is removed; its
  replacement lives in new modules under `packages/ui/src/lib/graph/`.
- `packages/ui/src/routes/Knowledge.tsx` — `GraphPanel` lazy-loads the view and hands it the
  project filter it already has.
- `packages/ui/package.json` — one new runtime dependency, `d3-force` (MIT, ~9 kB gzipped
  including its `d3-quadtree`/`d3-timer`/`d3-dispatch` deps), plus `@types/d3-force`. Zoom,
  pan and drag are built on the Pointer Events API rather than `d3-zoom`/`d3-drag`, which
  would pull in `d3-selection` and are close to untestable under jsdom.
- `packages/ui/src/test/` — new tests for the layout adapter, the viewport transform, the
  filter/search model and the detail panel; `knowledge.test.tsx` must tolerate the lazy
  graph panel.
- No changes to `packages/core`, `packages/server`, the CLI or the TUI.
