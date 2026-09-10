## 1. Model: carry what the new renderer needs

- [x] 1.1 Extend `MapNode` (`lib/map/model.ts`) with `updatedAt: string | null`, a ticket's
      `status`, and `hasLiveActivity: boolean` (true when a project/workspace node has an
      in-flight descendant ticket or a live worker under it), sourced only from data
      `GlobalMap.tsx` already fetches plus the new worker fetch (task 2.1); verify with updated
      `mapModel.test.ts` cases for each new field, including a node with no comparable siblings.
- [x] 1.2 Keep `buildMapModel`'s node/edge inclusion and edge rules unchanged; verify the existing
      `mapModel.test.ts` scenarios for node/edge inclusion still pass untouched.

## 2. Worker beams (data + pure model)

- [x] 2.1 Add a `useWorkersMany(ids)` call in `GlobalMap.tsx` (same hook the board uses) and pass
      live workers (reusing `isLiveWorker`/`kind === 'worker'` from `lib/board.ts`) to `MapCanvas`;
      verify no new HTTP route is introduced (grep the diff) and the existing loading/error
      composition in `GlobalMap.tsx` is unaffected when the workers query itself errors (beams
      simply don't show).
- [x] 2.2 Write `lib/map/beams.ts`: pure function mapping live workers + `MapModel` to `Beam[]`
      (`from`/`to` node ids, per design.md §6's parent-resolution: role, else project, else
      workspace); verify with unit tests covering a worker with a role, a worker with no role, and
      a worker whose ticket has no node on the map (dropped, not crashed).
- [x] 2.3 Add fade-out-on-retirement state handling (component-local, `diedAt` + timeout) and
      verify with a test that a beam persists in a "dying" state for the fixed duration after its
      worker leaves the live set, then is gone.

## 3. Radial layout

- [x] 3.1 Write `lib/map/radial.ts`: `layoutRadial(model)` implementing design.md §1 (leaf-count
      angular partition, fixed per-depth radius, full 0..2π sweep, minimum workspace gap); verify
      with unit tests: three workspaces of different sizes never share angular space, a
      lopsided tree (one branch far deeper) still keeps every sibling pair's spans disjoint, and a
      single-workspace, single-node map does not divide by zero.
- [x] 3.2 Verify with a unit test, at a range of node/workspace counts up to today's ~60, that no
      two nodes from different parents fall within their combined minimum visual radius of each
      other (the geometric form of "clusters do not overlap").

## 4. Drift

- [x] 4.1 Write `lib/map/drift.ts`: deterministic per-id phase/frequency (design.md §2) and
      `driftOffset(id, depth, t)`, with the amplitude cap derived from the layout's own minimum
      sibling gap at that depth; verify with a unit test that, over a full period, the offset never
      exceeds the passed-in cap.
- [x] 4.2 Wire a `requestAnimationFrame` loop in `MapCanvas.tsx` that writes drifted positions to
      node/edge/beam DOM attributes directly (no React re-render per frame, matching the existing
      view-tween technique already in the file); verify manually that motion is visible and that
      `prefers-reduced-motion` skips starting the loop (existing `useMediaQuery` + an added test
      asserting no `requestAnimationFrame` call under reduced motion).

## 5. Label decluttering

- [x] 5.1 Write `lib/map/labels.ts`: priority-ordered screen-space box suppression (design.md §3);
      verify with unit tests: a lower-priority label yields to a higher-priority one it overlaps,
      a hovered ticket's label appears when there is room and is suppressed when there is not.
- [x] 5.2 Recompute the shown-label set on data change and on zoom change only (not per drift
      frame); verify by asserting the recompute function is not invoked from the rAF drift
      callback (unit test around the wiring, not a timing test).

## 6. Rendering

- [x] 6.1 Replace `MapCanvas.tsx`'s `lib/graph/*`-based rendering (chips, hulls, force
      simulation) with: `<defs>` radial gradients keyed by colour (design.md §4), doubled-stroke
      edges, small circle nodes at the fixed per-kind core radii; verify by running the app
      locally and confirming edges read as the dominant bright element against node fills.
- [x] 6.2 Wire node/branch colour per design.md §5 (`projectColorVar` for workspace and project
      hue, status tokens for tickets, recency-derived glow opacity for role/knowledge, activity
      floor for project/workspace); verify with a unit test that a `blocked` ticket and an
      `in_progress` ticket resolve to different status-token colours.
- [x] 6.3 Confirm every colour used still resolves through a CSS custom property (no literal hex/
      rgb in the new code) — the existing lint gate on raw hex/px in components should already
      catch this; verify `pnpm lint` passes.
- [x] 6.4 Implement node pluck-and-spring-back drag (design.md §7) in place of the removed
      `simRef.drag`/`endDrag` calls; verify manually that dragging a node and releasing it returns
      it to its tree position, and that dragging one node does not visibly move any other.
- [x] 6.5 Remove the now-unused `lib/graph` imports from `MapCanvas.tsx`; verify
      `KnowledgeGraph.tsx` and its own tests are untouched and still pass (`pnpm --filter
      @agent-conductor/ui exec vitest run KnowledgeGraph`).

## 7. Phone list / filters / open-node (regression guard)

- [x] 7.1 Verify (existing behaviour, no code change expected) that the phone neighbour-list view,
      the kind filter toggles, and the Fit control still work against the new model/layout; adjust
      only what the removal of `lib/graph`'s `GraphModel` conversion breaks structurally.
- [x] 7.2 Verify selecting/opening a node still navigates exactly as today (existing
      `globalMap.test.tsx` open-node scenarios pass unchanged).

## 8. Tests and cleanup

- [x] 8.1 Update `globalMap.test.tsx` and `mapModel.test.ts` for the new model fields and
      rendering; add the new `lib/map/*.test.ts` files from tasks 2-5; verify `pnpm --filter
      @agent-conductor/ui exec vitest run` is green.
- [x] 8.2 Run `pnpm typecheck` and `pnpm lint` clean.
- [x] 8.3 Capture before/after screenshots of the global Map at phone portrait dimensions (matching
      the ticket's 1080x2376 reference) using the existing `ui-screenshot-harness` approach, and
      include both in the PR description, per the ticket's acceptance criterion 6.
