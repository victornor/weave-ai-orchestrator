## 1. Dependency and graph model

- [x] 1.1 Add `d3-force` and `@types/d3-force` to `packages/ui/package.json`, run `pnpm install`, and verify `pnpm --filter @agent-conductor/ui typecheck` still passes with the new types resolved.
- [x] 1.2 Write `packages/ui/src/lib/graph/model.ts` — `buildModel(graph)` producing node records (id, kind, title, group from `projectSlug ?? scope`, tokens, degree), an adjacency map, a neighbour lookup, and drawable edges that collapse a reciprocal `A→B`/`B→A` pair into one undirected edge and keep a one-way link directed. Verify with a new `packages/ui/src/test/graphModel.test.ts` covering degree, neighbours, reciprocal collapse and direction.
- [x] 1.3 Write `packages/ui/src/lib/graph/hull.ts` — monotone-chain convex hull plus padding, returning an SVG path for a group, and `null` for fewer than two points. Verify with unit tests for a triangle, a collinear set, a single point and a duplicate point.

## 2. Simulation

- [x] 2.1 Write `packages/ui/src/lib/graph/simulation.ts` — build a `d3-force` simulation from a `GraphModel` (many-body, link, collide, centre, and a per-group `forceX`/`forceY` for clustering), exposing start/stop, `tick` subscription and node position access. Verify a unit test that runs it to convergence on a small graph and asserts linked nodes end closer than unlinked ones.
- [x] 2.2 Add `reconcile(previous, next)` to the same module: surviving nodes keep `x/y/vx/vy` and their pins, new nodes are seeded at the centroid of their already-placed neighbours, removed nodes are dropped, and the simulation is reheated to a warm alpha rather than restarted. Verify tests for an unchanged refetch (positions identical), an added node (existing positions identical, new node near its neighbour) and a removed node.
- [x] 2.3 Add pin support (`pin(id)`, `unpin(id)` setting and clearing `fx`/`fy`) and `settle(iterations)` that ticks synchronously and schedules no frames. Verify tests that a pinned node's position is unchanged after ticking and that `settle` leaves the simulation stopped.

## 3. Viewport

- [x] 3.1 Write `packages/ui/src/lib/graph/viewport.ts` — the `{ k, x, y }` transform with `zoomAround`, `panBy`, `fitTo(bounds, size)`, `toGraph`, `pinchScale` for two pointers, clamped zoom bounds, and the label-detail thresholds (`labelDetail(k)` → `none | truncated | full`). Verify unit tests that the point under the pointer is invariant under `zoomAround`, that `fitTo` frames given bounds inside a given size within the bounds, that zoom clamps at both ends, and that `labelDetail` switches at the thresholds.

## 4. Filters, search and highlighting

- [x] 4.1 Write `packages/ui/src/lib/graph/filters.ts` — case-insensitive substring title match, a hidden-group set, the visible node and edge sets (an edge is dropped when either end is hidden), and `dimmed(id, {hover, selection, matches})` implementing the neighbourhood highlight. Verify unit tests for a multi-match search, a single match, an empty search, a hidden group dropping its edges, and hover dimming everything outside the neighbourhood.

## 5. The view

- [x] 5.1 Rewrite `packages/ui/src/routes/KnowledgeGraph.tsx` to render structure only — one `<g>` per node keyed by id, one `<path>` per drawable edge with an arrow marker for directed edges, one hull path per group behind them — and to write positions on each tick through a ref map rather than through React state. Delete `layoutGraph`. Verify the existing knowledge tests still pass and that a rendered graph exposes one element per node.
- [x] 5.2 Wire pointer handling on the SVG: node drag with pointer capture and a click/drag threshold, background pan, wheel zoom about the pointer, two-pointer pinch, and `touch-action: none`. Verify a test that synthetic `pointerdown/move/up` on a node moves it and does not select it, and that the same sequence on the background changes the transform and moves no node.
- [x] 5.3 Add the toolbar — search box, fit, reset, and the legend with per-group toggles and colours — and hide-group behaviour including the "everything hidden" empty state. Verify tests that typing in the search dims non-matches, that toggling a group off removes its nodes from the document, and that hiding every group shows the empty state.
- [x] 5.4 Add hover and selection highlighting and `GraphDetailPanel` — title, scope or project, tokens, degree, incoming and outgoing linked pages, an **Open page** action calling the existing `onOpen`, a pin toggle, and a close that clears the selection; keep double-click as the open shortcut. Verify tests that selecting a node renders the panel with its fields, that **Open page** and double-click both call `onOpen` with the node id, and that the pin toggle marks the node pinned.
- [x] 5.5 Add `GraphNeighbourList` and make it the default under the phone breakpoint, with a control switching to the canvas and back. Verify tests that under a phone-width match the list renders the selected node and its neighbours, that choosing a neighbour re-roots the list, and that the canvas control renders the SVG.
- [x] 5.6 Honour `prefers-reduced-motion: reduce`: mount, drag release, filter change, pin and refetch all go through `settle()`, and fit/reset write the transform in one step with no scheduled frames. Verify a test with the media query mocked as matching that no `requestAnimationFrame` is scheduled and that nodes are positioned after mount.

## 6. Integration, performance and delivery

- [x] 6.1 Make `GraphPanel` in `packages/ui/src/routes/Knowledge.tsx` load the view through `React.lazy` inside a `<Suspense>` with the existing skeleton fallback, and confirm `packages/ui/src/test/knowledge.test.tsx` still passes with the Graph tab both unopened and opened.
- [x] 6.2 Run `pnpm --filter @agent-conductor/ui build` before and after and record the main-chunk and graph-chunk sizes; confirm `d3-force` is absent from the entry chunk and put both numbers in the PR description.
- [x] 6.3 Check the acceptance size by hand: generate a 200-node / 600-edge graph in the browser harness, confirm drag, hover, zoom and pan stay responsive while it settles, and note the result in the PR.
- [x] 6.4 Capture screenshots at desktop and phone widths with the temporary Vite screenshot harness, attach them to the PR, and delete the harness before committing.
- [x] 6.5 Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm --filter @agent-conductor/ui exec vitest run`, and confirm all are green before requesting review.
