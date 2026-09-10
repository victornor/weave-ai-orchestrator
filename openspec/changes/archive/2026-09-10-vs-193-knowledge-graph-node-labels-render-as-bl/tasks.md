## 1. Confirm the diagnosis before changing anything

- [x] 1.1 Rebuilt the harness with a graph shaped like the real one (34 nodes / 67 edges, real
      titles and per-group sizes from this project's own KB), phone portrait, canvas mode.
      Screenshot (`/tmp/vs193/before-phone.png`, not committed) matches the ticket's report:
      blank rects with only a colour stripe, an edge hairball, content off both the left and
      right edges. Dumped the live DOM and confirmed all 34/34 `data-node` groups carry a
      correct `<text>` element — `labelFor`'s zoom gate is provably not firing; every blank chip
      is a real DOM node whose text is present but painted over by an overlapping sibling's
      opaque rect (confirms `design.md` decision 1 directly, not just by code trace). Node
      coordinates also span far outside the ~430×520 visible frame (e.g. x=-6.8..885.7,
      y=-171.9..619.8), confirming decision 2. Harness deleted before this commit.

## 2. Fix the stale mobile viewport measurement

- [x] 2.1 `KnowledgeGraph.tsx`: `frameRef` is now set through a callback ref (`attachFrame`)
      that measures immediately on mount and keeps a `ResizeObserver` attached afterwards, so
      the phone list→canvas transition (where the frame does not exist until the reader taps
      "Canvas") is measured too. Covered by a new component test
      ("re-measures the canvas frame once it exists...") that fails without the fix (no
      observer ever fires) and passes with it. `pnpm typecheck` and the full ui suite are green.
- [x] 2.2 Verified with the harness (phone viewport, list → tap Canvas, headless Chromium does
      real layout unlike jsdom): the scene's `transform` now fits against the frame's real
      measured width, confirmed by DOM dump (translate shifted to reflect a ~400px frame
      instead of the 900px fallback). Some overflow at the default zoom remains — that is the
      *existing*, unmodified "Opening at a readable zoom" requirement's own floor at
      `DEFAULT_ZOOM = 1` (titles must stay readable rather than being fit-shrunk into blobs),
      not a regression of this task. Task 3-5's compaction is what should bring a 31/67-scale
      graph's bounds close enough to fit without panning; re-checked at 5.1/5.3.

## 3. Stop siblings from overlapping and hiding each other

- [x] 3.1 Found during a corrected repro (see design.md 1a: `--virtual-time-budget` had been
      silently freezing the simulation at tick 1 in every propose-phase screenshot) that the
      *seed*, not the settled equilibrium, is the dominant term: `reconcileNodes`'s ring for
      brand-new nodes (the whole graph, on first load) was a flat `40 + n*1.6`, independent of
      chip size — 100 of 561 chip pairs already overlapped at seed time on the realistic 34-node
      graph, before a single tick. Replaced with `seedRing`, sized from the chips' own footprint;
      the same measurement now finds zero overlapping pairs at seed time
      (`simulation.test.ts`, "places every brand-new node... with no chip overlap"). Also eased
      `clusterForce`'s strength by `1/sqrt(group size)` and gave `forceCollide` more margin and
      iterations (4 instead of 2), so the settled equilibrium itself stays separated too —
      covered by two more `simulation.test.ts` cases (a 10-sibling cluster and the full
      34-node/67-edge graph, both zero overlapping pairs after `settle()`).
- [x] 3.2 Re-ran the harness (corrected this time: a real, non-virtual-time screenshot near first
      paint, plus a `--virtual-time-budget` one for the phone list→canvas flow specifically,
      since that only needed to get past the click, not advance the simulation). Every visible
      label at first paint now shows real text — no blank chips — confirmed by screenshot.
      `pnpm typecheck`, `pnpm lint` and the full `pnpm test` (root + ui) are green; one
      pre-existing test (`knowledgeGraph.test.tsx`'s Reset-returns-to-opened assertion) started
      failing on exact transform-string equality because the new seed values are the same value
      arrived at through different floating-point arithmetic — fixed by comparing the parsed
      x/y/k numerically (`toBeCloseTo`) instead of the transform string, which is what the test
      actually means to assert.

## 4. Never silently paint one label over another

- [x] 4.1 Added `chipsOverlap`/`suppressedLabels` (`lib/graph/simulation.ts`): a hub always
      outranks a document (never the one suppressed), the hovered or selected node always
      outranks a lower-degree neighbour, otherwise higher degree wins, ties broken by `id` so
      the choice is stable rather than flickering. Five unit tests in `simulation.test.ts` cover
      the rule directly with hand-built two/three-node fixtures — no real layout needed, per the
      task.
- [x] 4.2 Wired into `KnowledgeGraph.tsx`'s `draw()`: every tick, `suppressedLabels` runs over
      the live node positions (hover/selected read through refs, since `draw` is bound to the
      simulation once at creation and a state closure would go stale) and the losing chips'
      `<text>` gets `opacity: 0` — fading, not `display:none`, so nothing pops in and out
      abruptly as positions settle. Originally throttled to every ~120ms to bound the O(n²)
      check; dropped the throttle after it left a drag's suppression verdict visibly stale (a
      new component test — drag one chip exactly onto another's position, expect exactly one
      label left at opacity `''` and the other at `'0'` — failed against the throttled version
      for exactly that reason). Full cost is the same order `forceCollide` already pays a tick;
      see design.md's Risks for the measurement backing that call.

## 5. Reduce edge crossings and confirm the acceptance criteria

- [x] 5.1 Tried tuning charge strength (-420→-180), link distance (120→50 base) and cluster
      strength (0.08→0.4): the settled bounds for the realistic 34-node graph barely moved
      (~1600×1600 → ~1610×1400 units) under any of them. Also tried dialing the task-3 collide
      margin back down (+20→+8): same result. Measured why: the equilibrium is collision-area
      bound, not force-balance bound — 34 real chips (each 80-200+ units wide) need a fixed
      minimum non-overlapping area regardless of how the attractive/repulsive forces are tuned,
      and that minimum is far bigger than a ~380px phone frame at `DEFAULT_ZOOM = 1`. Reverted
      all four experiments (none helped) and raised `ac_ask` rather than deciding alone whether
      to shrink chips or relax the zoom floor to force everything on screen.
      **Resolved by captain**: AC3 means the graph's *shape* — distinct scope clusters, edges as
      structure — reads at the default view, not that all 34 individual labels must be
      simultaneously legible with no pan; the label-suppression backstop (task 4) handles the
      crowded parts, and reading one specific title at this density is normal pan/zoom
      interaction, not a defect. No further force tuning; zoom floor and chip sizing stay as
      they are. Edge crossings and cluster separation still visibly improved as a side effect of
      tasks 3-4 (no more sibling pile-ups to cross through) — screenshotted at 5.3.
- [x] 5.2 Search, Zoom in/out, Fit, Reset and List: unchanged code paths, and every existing
      `knowledgeGraph.test.tsx` scenario for them still passes (31 tests, plus the 2 new ones
      from tasks 2 and 4 — 33 total, all green).
- [x] 5.3 Captured a phone-portrait screenshot of the current state (34 nodes / 67 edges, shaped
      like this project's real knowledge base): every visible label renders as real text, no
      blank chips, no two labels overlapping — the ticket's headline defect is fixed. Content
      still extends past the visible frame at the default zoom (see 5.1's finding, resolved by
      captain — expected at this density, not a defect). Final before/after PR screenshots
      captured uncommitted in the worktree, per the shared screenshot convention.

## 6. Land it

- [x] 6.1 `pnpm typecheck`, `pnpm lint`, root `pnpm exec vitest run` and `packages/ui`'s own
      `vitest run` all green (2047 + 1237 tests respectively). One unrelated file,
      `packages/core/src/runs/engine.test.ts`, failed on a different assertion on two separate
      runs and passed clean on a third and fourth — confirmed pre-existing flake, nothing in
      this ticket touches `packages/core`.
- [x] 6.2 Already covered on the ticket during propose: the mechanism (opaque flat-order chips,
      seed-ring sizing) lives entirely in `packages/ui/src/routes/KnowledgeGraph.tsx` and
      `lib/graph/*`, which is this graph's own module tree — `MapCanvas.tsx`/`lib/map/*` are
      the Global Map's separate files. Nothing shared found.
