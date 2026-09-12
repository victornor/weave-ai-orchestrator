## 1. Dependencies

- [x] 1.1 Add `react-force-graph-2d` to `packages/ui/package.json`; run `pnpm install` and verify
      it resolves cleanly against React 19 with no peer-dependency warning.
- [x] 1.2 Remove `@xyflow/react`, `d3-force` and `@types/d3-force` from `packages/ui/package.json`
      once nothing in `packages/ui/src` imports them (verified in section 3); `pnpm install` again
      and confirm the lockfile no longer lists them.

## 2. Port the group-clustering force

- [x] 2.1 Extract `clusterForce` out of `lib/graph/simulation.ts` into a small standalone,
      renderer-agnostic module (or a private helper in the new route) that takes a strength and
      returns a `d3-force`-compatible force operating on `{ x, y, group }` nodes, unchanged in
      behaviour from today. Verify with a unit test porting `simulation.test.ts`'s existing
      cluster-force assertions.

## 3. Rewrite the route

- [x] 3.1 Rewrite `packages/ui/src/routes/KnowledgeGraph.tsx` against `<ForceGraph2D>`: feed it
      nodes/links derived from `buildModel`/`visible`/`matchingIds`/`highlighted` (unchanged from
      `lib/graph/model.ts` and `filters.ts`), register the ported cluster force via
      `graphRef.current.d3Force('cluster', ...)`, and keep the existing search box, group legend,
      detail panel and phone neighbour-list UI (`GraphDetailPanel`, `GraphNeighbourList` bodies are
      reusable near-unchanged — they read the model, not the renderer).
- [x] 3.2 Implement `nodeCanvasObject`: draw each node as a circle whose radius encodes degree
      (hub vs. document distinguishable per the modified spec) and whose fill is the node's group
      colour, plus its label per `labelDetail(zoom)` (near the node, not inside it) reading font/
      colour from the app's CSS custom properties. Verify by calling it directly against a
      recording fake `CanvasRenderingContext2D` and asserting radius, fill and text-drawn/omitted
      per zoom threshold.
- [x] 3.3 Implement `linkCanvasObject` (or `linkColor`/`linkDirectionalArrowLength` as
      `react-force-graph-2d` provides) for edges: arrowhead only on one-way links, trimmed to the
      target circle's boundary, dimmed when either end is outside the lit neighbourhood or search
      match set. Verify with a unit test on the edge-trim math (circle-boundary intersection) and
      a canvas-callback test for the dimming condition.
- [x] 3.4 Wire `onZoom`/`onZoomEnd` to drive `labelDetail(zoom)` state, `onNodeHover` to drive the
      existing hover-neighbourhood highlight, `onNodeClick` to selection (opens
      `GraphDetailPanel`), `onNodeDrag`/`onNodeDragEnd` to keep the existing drag-does-not-select
      behaviour, and remove the Zoom in/Zoom out/Fit/Reset buttons and their handlers entirely.
      Verify by reading `react-force-graph-2d`'s published types for each callback's signature
      before wiring it. — Implemented `labelDetail` off `nodeCanvasObject`'s own `globalScale`
      argument instead of an `onZoom`-driven state variable: it is the same current-zoom value,
      supplied per-frame already, so no separate zoom tracking is needed. Buttons removed.
- [x] 3.5 Confirm the graph opens at a readable default zoom (not a tight fit) using
      `react-force-graph-2d`'s initial-zoom/`zoomToFit` options, matching the modified "Opening at
      a readable zoom" scenario. — `onEngineStop` calls `zoomToFit` then floors at `DEFAULT_ZOOM`.

## 4. Delete obsolete code

- [x] 4.1 Delete `lib/graph/simulation.ts`, `lib/graph/hull.ts`, `test/graphSimulation.test.tsx`
      (formerly `simulation.test.ts`'s counterpart) and any hull-specific assertions inside
      `test/graphFilters.test.tsx`/`test/knowledgeGraph.test.tsx`. Verify with
      `grep -rn "lib/graph/simulation\|lib/graph/hull" packages/ui/src` returning nothing. — also
      found and removed a `hull` describe block inside `test/graphModel.test.tsx` that tasks.md did
      not name; `graphFilters.test.tsx` had no hull references.
- [x] 4.2 Remove the `DOMMatrixReadOnly` shim from `packages/ui/src/test/setup.ts`. Verify
      `grep -n "xyflow\|DOMMatrixReadOnly" packages/ui/src/test/setup.ts` returns nothing.
- [x] 4.3 Confirm `packages/ui/src/routes/MapCanvas.tsx` is unaffected: its import of
      `lib/graph/viewport.ts` still resolves and `pnpm --filter @weave-ai/ui exec vitest run
      src/test/globalMap.test.tsx src/test/mapBeams.test.ts src/test/mapDrift.test.ts
      src/test/mapLabels.test.ts src/test/mapModel.test.ts src/test/mapRadial.test.ts` stays green.
      `git diff --stat` on `MapCanvas.tsx`/`viewport.ts`/`model.ts`/`filters.ts` is empty.

## 5. Tests

- [x] 5.1 Rewrite `packages/ui/src/test/knowledgeGraph.test.tsx` per design.md Decision 6: mock
      `react-force-graph-2d` for component-level tests of what `KnowledgeGraphView` computes and
      passes down (nodes/links shape, group legend, search dimming, selection → detail panel,
      phone neighbour-list) without mounting the real canvas component. — confirmed first that the
      real component crashes under jsdom ("Cannot read properties of null (reading 'scale')" from
      `force-graph`'s own `adjustCanvasSize`, via `HTMLCanvasElement.getContext` not implemented),
      exactly as design.md predicted, before committing to the mock strategy.
- [x] 5.2 Add unit tests for the new pure adapter functions (degree→radius, group→colour,
      `labelDetail(zoom)` if not already covered, edge circle-trim math, label-suppression
      scoring) at the same granularity `simulation.test.ts` tested `chipSize`/`rectIntersection`/
      `suppressedLabels` today. — `lib/graph/nodes.test.ts`, `lib/graph/cluster.test.ts`.
- [x] 5.3 Run `pnpm lint && pnpm typecheck && pnpm test` and paste both suite totals (core/server
      and UI) verbatim in the delivery report — not summarized, not added together. — all green;
      see the ticket report/comment for the verbatim totals.

## 6. Manual verification and evidence

- [x] 6.1 Run the app against real workspace data (per [[ui-screenshot-harness]] or the local dev
      server) and state the node/edge counts used for the "stays responsive at scale" check. — no
      live workspace data is reachable from a worker's isolated sandbox; used the
      [[ui-screenshot-harness]] recipe (throwaway `screenshot.html`/`screenshot.tsx`, deleted
      before commit) with a synthetic 36-node/47-edge graph at the scale the spec's own "structure
      reads at workspace scale" scenario names (~30 pages, a handful of groups), and a
      226-node/667-edge graph for the "stays responsive at workspace scale" requirement's
      200-node/600-edge floor.
- [x] 6.2 Capture and attach screenshots — done via a CDP-driven headless Chromium (real browser,
      real canvas, real dispatched wheel/pointer input, not jsdom): see the ticket comment for the
      four screenshots and exactly what was done with the mouse for each. Two real bugs were found
      and fixed this way (layout drift with nothing bounding it, and auto-fit not running until a
      15-second-distant `onEngineStop`) that no amount of source-reading would have caught.
- [x] 6.3 Manually verify (cannot be asserted under jsdom, see design.md Decision 6): scroll-wheel
      zoom around the pointer, background drag pan, node drag moving its neighbours, and hover
      highlighting — confirmed scroll-wheel zoom (real dispatched wheel events, screenshot 2) and
      hover-neighbourhood dimming (screenshot 3) directly. Background-drag-pan and node-drag were
      exercised by reading `enablePanInteraction`/`enableNodeDrag`'s default-on behaviour and the
      drag-end fx/fy semantics confirmed in `force-graph`'s own source (design.md's "Decisions"
      section), not by a dispatched-drag screenshot — a `d3-drag` gesture cannot be synthesized via
      CDP's discrete mouse events (the same jsdom/automation limitation
      [[react-flow-in-packages-ui]] already found for React Flow's own `d3-drag` use, now
      confirmed to extend to `force-graph`'s identical use of `d3-drag`). Flagged as the one
      interaction not directly screenshotted, for the human's own click-through.

## 7. Spec and dependency bookkeeping

- [x] 7.1 Confirm `package.json`'s final dependency list states which route (if any) still needs
      `@xyflow/react` — expected answer: none, so it is fully removed — per acceptance criterion 1.
      — confirmed: no route needs it; removed entirely, along with `d3-force`/`@types/d3-force`.
- [x] 7.2 Confirm `KnowledgeGraph.tsx`'s final line count is substantially below 807 and note the
      number in the delivery report, per acceptance criterion 7. — 578 lines (down from 807, ~28%
      smaller), plus two new small focused modules (`lib/graph/nodes.ts` 153 lines,
      `lib/graph/cluster.ts` 76 lines) replacing the deleted 509-line `simulation.ts` and 65-line
      `hull.ts`.
