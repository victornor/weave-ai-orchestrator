## 1. Dependency and a jsdom sanity check

- [x] 1.1 Add `@xyflow/react` to `packages/ui/package.json`; run `pnpm install`; verify
      `pnpm typecheck` still passes with no other change (confirms the dependency resolves cleanly
      against React 19 and the repo's TS config). Done: `@xyflow/react@^12.11.6` added, `pnpm
      install` resolved 17 new packages, `pnpm typecheck` clean with no other change.
- [x] 1.2 Before rewriting any existing test, mount a minimal `<ReactFlow>` with one node under
      `@testing-library/react` in this repo's vitest + jsdom setup; verify it renders without
      throwing (React Flow reads element geometry for some internals — confirm this repo's existing
      `resizeObserver.ts` test helper is sufficient, or note in the PR what additional jsdom shimming
      was needed, per design.md §8). Done: a throwaway test mounting `<ReactFlowProvider><ReactFlow
      nodes={...} /></ReactFlowProvider>` rendered `.react-flow` cleanly on the first try under this
      repo's existing `setup.ts` (ResizeObserver/matchMedia/PointerEvent polyfills already there) —
      no additional jsdom shimming needed. Deleted after confirming.
- [x] 1.3 Retire the biggest open unknown before the 700-line rewrite, not after: build a throwaway
      real-browser harness (this project's `ui-screenshot-harness` convention) driving `<ReactFlow>`
      with `createSimulation()`'s real output for a ~200-node/~600-edge seeded graph, pushing
      positions into React Flow's node state via `setNodes` on every tick exactly as design.md §2
      proposes, and measure frame rate during the initial settle and during a simulated drag
      (reheat). Record the actual numbers in the PR. If frame rate holds, Decision 2's approach
      proceeds as designed. If it does not, switch to the imperative DOM-write fallback design.md §2
      names (positions written directly to each node's element, outside React's render cycle,
      `setNodes` reserved for occasional state) before task 3 builds the rest of the component on top
      of whichever strategy actually holds — this is a finding to make now, not a failed rewrite to
      discover at task 7. **Done, measured in real headless Chromium** (throwaway
      `perfharness.html`/`src/perfHarness.tsx`, a synthetic 200-node/6-hub/~640-edge graph via
      `buildModel`, driven via CDP exactly as VS-264's repro was): during the initial settle burst,
      83 ticks over 1512ms = **18.2ms/tick avg (~55fps)**; during a sustained simulated drag
      (continuous `sim.drag()` reheat), 175 ticks over 1508ms = **8.6ms/tick avg (~116fps)**. Both
      hold a reasonable frame rate — settle is close to the 16.7ms/60fps budget and drag is well
      under it. `setNodes`-per-tick (Decision 2's primary strategy) proceeds as designed; the
      imperative DOM-write fallback is not needed. Harness deleted after recording these numbers.

## 2. Rectangle geometry (pure, unit-tested first)

- [x] 2.1 Add `rectIntersection(cx, cy, halfW, halfH, tx, ty)` to `lib/graph/simulation.ts`
      (design.md §4); verify with unit tests: a horizontal approach trims at `halfW`, a vertical
      approach trims at `halfH`, and a near-vertical approach into a wide/short chip trims at the
      real half-height rather than at the old circle's radius (the acceptance criterion's specific
      case) — assert the numeric point, not just "it changed." Done: 5 new tests in
      `simulation.test.ts` (horizontal, vertical, near-vertical against the exact 96.5/12 chip
      VS-264 measured, diagonal, and the centre-on-centre degenerate case).
- [x] 2.2 Add `rectCollide(padding, strength)` to `lib/graph/simulation.ts` (design.md §5), replacing
      `forceCollide` in `createSimulation()`'s force stack; tune `padding`/`strength` against task
      2.3's test until it passes, and note in the PR if the tuned values differ substantially from
      today's `+20`/`iterations(4)`. Done, with an added `iterations` parameter (kept at 4→6, see
      below) since a single position-correction pass per tick converged slower than `forceCollide`'s
      internal quadtree solver did at the same iteration count. Tuned values: `padding=16`
      (close to today's `+20` margin), `strength=1.4` (needed to be higher than a naive 0.5-1.0 guess
      — direct rectangle separation without `forceCollide`'s quadtree-mediated damping needed more
      correction per pass to converge in `SETTLE_TICKS`), `iterations=6` (raised from the planned 4
      because 4 left exactly one pair overlapping on the realistic 34-node graph, see task 2.3).
- [x] 2.3 Verify with a `simulation.test.ts` case, using the existing `multiGroupGraph()` fixture (34
      nodes / 5 groups), that after `sim.settle()` `chipsOverlap` reports zero overlapping pairs —
      this is acceptance criterion 3, and it must use `chipsOverlap` itself, not a looser radius
      check, per the ticket. Done: this test already existed (`keeps the realistic 34-node/67-edge
      graph apart after settling`) and now passes unchanged against `rectCollide` — no new test
      needed, but tuning `rectCollide` against it took two iterations (see 2.2).
- [x] 2.4 Update `edgePath()` (`KnowledgeGraph.tsx` today, wherever it lives after task 4) to trim
      both endpoints via `rectIntersection` instead of `link.source.radius`/`link.target.radius`;
      verify with a unit or component test asserting a near-vertical edge's endpoint lands at the
      target chip's real rectangle boundary, not ~84 units short of it (acceptance criterion 2).
- [x] 2.5 Confirm `nodeRadius()` is kept for `linkDistance()` and `suppressedLabels()`'s priority
      maths (design.md §5) and is no longer read by `edgePath()` or the collide force; grep for any
      other caller before deciding it is otherwise unused. Done, with a correction: grepping the
      actual callers shows `nodeRadius()` is used by `seedRing()` and `reconcileNodes()` (which sets
      `SimNode.radius`, in turn read by `linkDistance()`) — not by `suppressedLabels()`/`labelScore`,
      which only reads `kind`/`degree`/`id` and never touched `nodeRadius()` even before this change.
      That part of the task's premise was inaccurate; `edgePath()` and the collide force are
      confirmed as the only two call sites removed.

## 3. React Flow wiring

- [x] 3.1 Build a `KnowledgeChipNode` custom node type rendering the existing chip visuals (rect,
      accent stripe, label, pin dot) sized from `chipSize()`, preserving the `data-node`/`data-chip`/
      `data-kind`/`data-dimmed`/`data-pinned` attributes existing tests and call sites query; verify
      by rendering one node and asserting those attributes are present. Done — same JSX shape as the
      old `GraphNodeShape`, same data attributes, now inside an RF node wrapper.
- [x] 3.2 Build a custom edge type using `rectIntersection` for both endpoints, rendering the
      existing arrowhead marker for directed edges and the existing dimmed/undimmed stroke styling;
      verify a directed edge gets `marker-end` and a mutual edge does not (existing
      `knowledgeGraph.test.tsx` coverage, ported). **Deviates from the plan, for a real reason found
      in testing, not a preference**: a genuine React Flow *edge type* (`EdgeProps`, `useInternalNode`)
      was built first and confirmed reachable (its console output fired every tick), but in a real
      Chromium render — not jsdom — React Flow never drew it: its edge renderer requires
      `internals.handleBounds` to be populated before it will draw anything touching a node, and that
      measurement pass never completed for our custom, handle-less chips, with or without an added
      `<Handle>` pair or a forced `useUpdateNodeInternals()` call. Rather than keep chasing an
      internal measurement pipeline this canvas doesn't need (no user-drawn connections, ever),
      edges are now drawn as a single overlay **node** (`EdgesLayerNode`, one per graph, `zIndex: 0`)
      containing every edge's path plus the arrowhead `<marker>` def — the same technique already
      used for cluster hulls (see 3.6), verified in a real browser to actually paint: 39/39 edges
      visible with arrows landing on the real chip boundary, confirmed by screenshot. `rectIntersection`
      is used exactly as planned; only its caller moved.
- [x] 3.3 Wire `createSimulation()`'s `onTick` to update node positions using whichever strategy task
      1.3 validated (design.md §2: `setNodes` per tick, or the imperative DOM-write fallback if 1.3
      found `setNodes` too slow) instead of writing SVG `transform` attributes through refs; verify
      nodes visibly move on tick and that reduced motion still settles in one synchronous pass with
      no `requestAnimationFrame` scheduled (existing "reduced motion" describe block, ported). Done:
      `setNodes` per tick, per task 1.3's measurement. Reduced-motion assertion not yet re-verified
      by an actual test (task 7.1).
- [x] 3.4 Wire node drag to `sim.drag`/`sim.endDrag` via React Flow's `onNodeDrag`/`onNodeDragStop`;
      verify dragging a node moves it and does not select it, and that a plain click still selects
      (existing "dragging and panning" tests, ported). Wired (`onNodeDrag` converts RF's top-left
      position back to the simulation's centre convention and calls `sim.drag`; `onNodeDragStop`
      calls `sim.endDrag`; `nodeClickDistance={4}` replaces the old `CLICK_SLOP_PX` threshold so RF
      itself decides drag-vs-click). Not yet re-verified by a real interaction test — task 7.1.
- [x] 3.5 Wire pin/unpin exactly as today (`sim.pin`/`sim.unpin` from the detail panel's Pin button);
      verify the pinned visual and pin persistence tests still pass. Wired, unchanged logic from the
      old component; not yet re-verified by test — task 7.1.
- [x] 3.6 Draw the group hulls as an SVG overlay from `hullPath()` over the current node positions in
      React Flow's coordinate space; verify a group with 2+ visible nodes still gets a drawn region
      and a single-node group does not (existing hull test, ported). Done as a `HullNode` custom node
      type (`zIndex: -1`, positioned at the origin, drawing `hullPath()`'s absolute-coordinate path
      directly — no coordinate translation needed since React Flow's own pan/zoom transform already
      applies to the whole node layer). **Landmine found and fixed**: a node with no explicit
      `width`/`height` and no `<Handle>`-driven measurement stays `visibility: hidden` forever in
      React Flow, regardless of what its content actually renders — this hit both the hull node and
      the new edges-layer node identically (confirmed via real-browser computed-style inspection,
      not guessed) and is fixed by giving both node objects `width: 1, height: 1` explicitly, exactly
      like the chip nodes already had. Verified visually: hulls now render as translucent regions
      behind edges behind chips, matching the existing "behind the edges and nodes" requirement.

## 4. Viewport: hand it to React Flow

- [x] 4.1 Remove `KnowledgeGraph.tsx`'s import of `lib/graph/viewport.ts`, the wheel `useEffect`, the
      pointer-based pan/pinch handlers, and `applyView`/`moveView`/`toSvg`; wire Zoom in/Zoom out/
      Fit/Reset to React Flow's `useReactFlow()` (`zoomIn`/`zoomOut`/`fitView`/`setViewport`),
      matching today's `MIN_ZOOM`/`MAX_ZOOM`/`DEFAULT_ZOOM` bounds and the "opens at a readable zoom,
      not fitted past the floor" behaviour; verify with the existing button and Reset/Fit tests,
      ported. Done, with one deviation from design.md §3's plan: instead of `useReactFlow()` (a hook,
      unusable from `KnowledgeGraphView` since the toolbar buttons are siblings of `<ReactFlow>`, not
      descendants), the `onInit` callback's `ReactFlowInstance` is captured in a ref and its
      `zoomIn`/`zoomOut`/`setViewport`/`getViewport`/`getNodesBounds` methods are called directly —
      the same public API, reached without needing a `<ReactFlowProvider>` wrapper. Reset computes
      `getViewportForBounds` (React Flow's own bounds-to-viewport function) then floors the zoom at
      `DEFAULT_ZOOM`, replicating `defaultView()`'s old behaviour without importing `viewport.ts`.
      Not yet re-verified by a ported button/Reset/Fit test — task 7.1.
- [x] 4.2 Verify scroll-wheel zoom works over the graph without the surrounding page scrolling —
      per design.md §8, do this via the project's `ui-screenshot-harness`/real-browser convention if
      jsdom cannot exercise real wheel-gesture ownership, and say plainly in the PR which check
      covers acceptance criterion 1's "does not scroll the page instead" clause. Verified in real
      headless Chromium (not jsdom): a wheel gesture dispatched via CDP over the canvas changed the
      viewport's scale from 1 to 1.51572 and `window.scrollY` stayed 0 throughout. This is the
      real-browser check the design called for; no jsdom equivalent was attempted for the gesture
      itself since jsdom cannot dispatch a genuine wheel-ownership contest.
- [x] 4.3 Recompute `labelDetail()`'s zoom threshold from React Flow's live viewport zoom instead of
      `viewRef.current.k`; verify the existing "shortens the labels far out, shows them in full close
      in" test, ported. Done: `onMove` (an RF prop, no provider needed) recomputes `labelDetail(zoom)`
      on every viewport change, same early-return-if-unchanged pattern the old `applyView` used. Not
      yet re-verified by a ported test — task 7.1.
- [ ] 4.4 Grep `MapCanvas.tsx`'s actual import list from `lib/graph/viewport.ts`; remove only the
      exports `viewport.ts` no longer has any caller for once `KnowledgeGraph.tsx` stops importing
      it, keeping every export `MapCanvas.tsx` still uses; verify `viewport.test.tsx`/
      `graphViewport.test.tsx` (whichever still applies) and `MapCanvas`'s own tests are unaffected.
      **Deliberately not done.** `KnowledgeGraph.tsx` no longer imports `viewport.ts` at all (grep
      confirms only `MapCanvas.tsx` and `simulation.ts` do, plus `graphViewport.test.tsx`'s own unit
      tests), so several exports (`MIN_ZOOM`/`MAX_ZOOM`/`DEFAULT_ZOOM`/`ZOOM_STEP`/`LabelDetail`/
      `labelDetail`/`clampZoom`/`apply`/`defaultView`/`centreOn`) are plausibly dead outside their own
      test file now. Pruning them risks trimming `graphViewport.test.tsx`'s legitimate module-level
      unit coverage for a purely cosmetic win, and this ticket's time budget went to the functional
      gaps (edges not rendering at all) instead. Left as a named follow-up rather than silently
      dropped or falsely marked done.

## 5. Feature parity sweep

- [x] 5.1 Verify search/highlight (`matchingIds`, `highlighted`, `nodeDimmed`/`edgeDimmed`) still
      dims correctly against the React Flow node/edge components — existing `filters.ts` is
      unchanged, only its consumers moved; port the "search and the legend" and "highlighting,
      selection and detail panel" test blocks. Done — ported and passing (task 7.1's suite).
- [x] 5.2 Verify group hide/show (legend toggles) still removes nodes from drawing and layout and
      lets the rest settle, porting the existing legend tests. Done — ported and passing.
- [x] 5.3 Verify the phone breakpoint's neighbour list and the Canvas/List toggle are unaffected —
      `GraphNeighbourList` does not touch the canvas at all; port the existing "the phone"
      describe block unchanged in intent. Done — ported and passing, including the frame
      re-measurement test (which surfaced the `onInit` timing landmine documented in 7.1).
- [x] 5.4 Verify a data refetch with unchanged nodes/edges leaves every node exactly where it was
      (existing `reconcileNodes` contract, ported "a refetch" test). Done — ported and passing.
- [x] 5.5 Verify light and dark both render every colour from existing CSS custom properties, with
      no hardcoded hex/rgb introduced by the new node/edge components (acceptance criterion 4);
      `pnpm lint`'s existing raw-hex/px guard should catch a regression here. Done: `pnpm lint`
      clean, and a direct grep of `KnowledgeGraph.tsx` for hex literals finds none — every colour is
      a `var(--...)` CSS custom property, same as before.

## 6. Regression guard: the Instance Map is untouched

- [x] 6.1 Verify `MapCanvas.tsx` still renders and its existing tests
      (`pnpm --filter @agent-conductor/ui exec vitest run MapCanvas`, or whichever file covers it)
      pass unmodified — acceptance criterion 5. This is the change most likely to break by accident
      here, since it shares `lib/graph/viewport.ts` with the code being rewritten. Done:
      `globalMap.test.tsx` (11 tests), `viewport.test.tsx` (10) and `graphViewport.test.tsx` (15) all
      pass unmodified, 36/36.
- [x] 6.2 Confirm no other file outside `KnowledgeGraph.tsx`/its own tests/`simulation.ts` changed as
      a side effect of this work; if `lib/graph/model.ts`/`filters.ts`/`hull.ts` needed any change
      beyond wiring, say so plainly rather than letting it pass silently. Confirmed via `git diff
      --stat` against main: only `KnowledgeGraph.tsx`, `simulation.ts`, `simulation.test.ts`, and
      `packages/ui/package.json`/`pnpm-lock.yaml` (the new dependency) have changed.
      `model.ts`/`filters.ts`/`hull.ts` needed no changes — their existing pure contracts were reused
      as-is, matching the plan's estimate.

## 7. Tests, lint, typecheck

- [x] 7.1 Rewrite `knowledgeGraph.test.tsx` against the React Flow DOM shape, porting every existing
      scenario (node/edge drawing, drag/pan, wheel zoom, pinch zoom, label detail by zoom, buttons,
      search/legend, highlighting/selection/detail panel, phone, reduced motion, refetch) rather than
      dropping coverage; add the acceptance-criterion-2 near-vertical-edge case and the
      acceptance-criterion-3 zero-overlap case if not already covered by `simulation.test.ts`. Done,
      27/27 passing. Two scenarios could not be ported as real interaction tests and are documented
      inline instead of silently dropped: (1) dragging a node — d3-drag (React Flow's own mechanism)
      needs a `mousedown` event whose `view` is a real `Window`, and this repo's jsdom/testing-library
      combination throws either way (`view` omitted → d3-drag's own `event.view.document` throws;
      `view` supplied → jsdom's `MouseEvent` constructor rejects it as "not of type Window").
      (2) The exact wheel-zoom gesture — already covered by task 4.2's real-browser check, per
      design.md §8's own plan for this. Everything else, including Zoom in/out/Fit/Reset, is a real
      jsdom assertion, not a placeholder — see 7.1's own commits for two real product bugs this
      rewrite found in the process (fitView/resetView ignoring reduced motion; zoomIn/zoomOut not
      applying reliably under this stack, fixed by switching to the same setViewport path Fit/Reset
      already used).
- [x] 7.2 Run `pnpm lint && pnpm typecheck` clean. Both clean.
- [x] 7.3 Run `pnpm test` (both suites — core/server and the UI suite run separately; report both
      blocks verbatim with real totals, per house convention) and confirm both are green. Both green:
      core/server 165 passed | 1 skipped (166 files), 2410 passed | 1 skipped (2411 tests); UI 89
      passed (89 files), 1484 passed (1484 tests). Full blocks in the delivery report.
- [x] 7.4 Write the delivery report: what survived vs. what was rewritten (compare against the
      ~700/~1,700-line estimate in the ticket and say if it was materially off), which part of
      acceptance criterion 1 was verified by unit test vs. by the screenshot-harness convention, the
      Fit/Reset decision (kept, per design.md §3, matching existing behaviour) and why, and confirm
      `viewport.ts` still exists solely for `MapCanvas.tsx`. Done in the ticket's delivery report.
      The line-survival estimate was materially off in a specific way worth flagging: `model.ts`/
      `filters.ts`/`hull.ts` (269 lines) survived completely unchanged as predicted, but the total
      line count did **not** shrink (1726 now vs. ~1700 before) — React Flow's own node/edge system
      replaced the removed ~400 lines of pointer/wheel plumbing with a comparable amount of new
      bridging code (custom node/hull/edges-layer components, the visual context, viewport-button
      wiring reached via a captured `ReactFlowInstance` rather than `useReactFlow()`), because this
      canvas needed custom-drawn edges and hulls rather than a chance to delete rendering code
      wholesale. The library did fix both root causes (event ownership, circle-for-rectangle); it did
      not shrink the file the way "adopt a library" often implies.
