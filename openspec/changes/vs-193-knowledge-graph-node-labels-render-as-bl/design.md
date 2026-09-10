## Context

The graph is `packages/ui/src/routes/KnowledgeGraph.tsx` plus `lib/graph/{model,simulation,viewport,filters,hull}.ts`
(the module map is described at the top of `KnowledgeGraph.tsx`). React renders the static SVG
structure once; a `d3-force` simulation (`lib/graph/simulation.ts`) writes node/edge geometry
straight onto the DOM through a ref map on every tick, so the component only re-renders on real
state changes (selection, hover, filters, the zoom-derived label `detail` tier).

I reproduced the layout with a throwaway harness (`docs/ui-screenshot-harness.md`'s recipe:
`screenshot.html` + `screenshot.tsx`, seeded `QueryClient`, headless Chromium at a 430×932 phone
viewport, the phone "Canvas" control auto-clicked to reach the same view captain screenshotted) —
not committed, per that doc. At a 31-node / 67-edge graph shaped like this project's real
knowledge base, the settled layout already shows visible chip-on-chip overlap and off-frame
content, confirming the mechanism below rather than requiring an untestable guess. I could not
reproduce the *severity* of the production report (27 of 31 labels fully blank) from inside a
sandboxed worker — I have no access to the real `/knowledge/graph` payload or a live browser
against the running app — so the diagnosis below is the leading, code-confirmed hypothesis, and
task 1 is to re-confirm it against a closer repro before changing anything, exactly as the ticket
asks.

## Goals / Non-Goals

**Goals:**
- Make every node's label paint at the default view, mobile portrait first.
- Make the mobile canvas measure the frame it is actually shown in.
- Add a last-resort label-collision rule so a future layout regression degrades to a faded
  label, never a silently-hidden one.
- Reduce edge crossings and sibling crowding enough that 31 pages / 67 links read as structure.

**Non-Goals:**
- No new layout algorithm (e.g. a hierarchical or force-directed-with-constraints rewrite).
  `d3-force` stays; this tunes its forces and fixes measurement/paint-order bugs.
- No change to what counts as a hub, a group, or an edge (that's `lib/graph/model.ts` and the
  server's `/knowledge/graph`, out of scope per the ticket).
- No redesign of the chip's visual style, the legend, or the detail panel.

## Decisions

### 1. Blank labels: opaque siblings painting over each other, not the zoom-detail gate

`labelFor` (`KnowledgeGraph.tsx:491-495`) only hides a non-hub, non-focused label when the
zoom-derived `detail` tier is `'none'` (below `LABEL_TRUNCATED_ZOOM = 0.6`, `viewport.ts:47`).
I traced every path that can set the view's zoom on open: `defaultView` (`viewport.ts:125-131`)
always floors `k` at `Math.max(fitted.k, DEFAULT_ZOOM)` where `DEFAULT_ZOOM = 1` — comfortably
above `0.6` — and it is the only function `draw()`'s autofit calls (`KnowledgeGraph.tsx:165-168`).
So `detail` cannot become `'none'` from the initial autofit, on any viewport size, with any
graph shape. That gate is not the cause of a *first-load* blank label; it only matters after a
reader manually zooms out (task 5 keeps that behaviour but is not the fix for this ticket).

What both my repro and the code confirm instead: `GraphNodeShape` (`KnowledgeGraph.tsx:532-566`)
draws every chip as an **opaque** `<rect fill="var(--bg-1)">` with the label centred inside, and
`shown.nodes.map(...)` (`KnowledgeGraph.tsx:450-465`) paints them in flat array order with no
regard for overlap — a later chip fully occludes an earlier one wherever they overlap, leaving
only the earlier chip's accent stripe visible if the stripe sits outside the overlap (`rect`
at `x={-hw}`, width `3`, `KnowledgeGraph.tsx:566` — exactly "a black rectangle with a coloured
edge and no text"). Siblings in the same group have no edge between them (`model.ts` only adds
an edge per resolved link, and pages in the same scope rarely link to each other) and are held
apart only by `forceCollide` (`simulation.ts:218`, `iterations(2)`) fighting a **constant**
`clusterForce(0.08)` pull toward the group centroid (`simulation.ts:150-172`, no falloff as a
group grows). `nodeRadius` (`simulation.ts:69-72`) approximates a wide, short chip as a circle
of radius `max(width, height)/2` — sound for same-height pairs, only approximate off-axis — and
two rounds of collision relaxation per tick is thin for a group with many siblings converging on
one centroid at once. A hub tends to stay legible because it is drawn larger (`CHIP_H_HUB=28` vs
`24`, plus its own degree-based `grow`, `simulation.ts:54-66`) and is pulled toward the *average*
of many linked documents by the link force rather than toward one dense sibling clump.

This is a layout-density bug with a rendering-order consequence, not a single-line fix. The
work is in three parts:
- **Stop it from starting overlapped**: see 1a below — this turned out to be the dominant term.
- **Reduce how often it happens at rest**: give the collide force more room and more iterations,
  and make `clusterForce`'s pull ease off as a group's page count grows, so collision resolution
  can keep up (spec: "A crowded group stays legible").
- **Guarantee it is never silently wrong when it still happens**: after the layout settles (or
  on every tick, cheaply — see Risks), detect chips whose screen-space bounds actually overlap
  and fade/hide the lower-priority label instead of leaving both drawn with one painted over
  the other (spec: "Two chips still end up close together" / "A hub is never hidden").

#### 1a. The dominant term, found during apply: the seed ring, not the settled equilibrium

Task 1's harness screenshot used `--virtual-time-budget`, which turned out to stop Chromium's
compositor from ever driving `requestAnimationFrame` — so every "settled" screenshot in the
propose phase was actually capturing tick 1, not a converged layout. That is not a harness bug
to shrug off: it accidentally reproduces what a reader really sees, because `d3-force`'s default
alpha decay takes on the order of 300 ticks (~5s at 60fps) to fully settle, and nobody holds
their phone still on a glanced-at page for five seconds. What matters most is what tick 1 looks
like, not the eventual rest state.

And tick 1 was bad on its own terms, independent of `clusterForce`: `reconcileNodes`
(`simulation.ts:92-142`) seeds every node with no `previous` entry — true of the *entire* graph
on first load — around a ring of radius `40 + n*1.6` (`simulation.ts:98`, before this change). For
34 real-sized chips that is a ~95-unit ring holding chips whose own radius is 40-100+ units: a
direct unit-test measurement (`reconcileNodes([], model, centre)`, no ticking) found **100 of 561
chip pairs already overlapping** the instant the graph is seeded, on a graph shaped like this
project's real knowledge base. `clusterForce` and `forceCollide` only get a chance to undo that
over the next several seconds; a reader who looks for one or two sees mostly the pile-up.

Fixed by sizing the ring from the chips actually being placed (`seedRing`, `simulation.ts`)
instead of a flat per-node constant: circumference enough for every chip side by side around it,
plus a third again for room to ease into. The same unit test now finds zero overlapping pairs at
seed time. This does not change the settled equilibrium's size — forces converge to a balance
independent of where nodes started — only how chaotic the animation into it looks, which is most
of what "the graph looks like a hairball" turns out to mean in practice.

### 2. Off-canvas content and the phone hull clipping: a stale viewport measurement

`measure()` (`KnowledgeGraph.tsx:100-106`) reads `frameRef.current?.clientWidth`, falling back
to `FALLBACK_SIZE` (900×520, `KnowledgeGraph.tsx:48`) when the ref is null. On phone the canvas
`<div ref={frameRef}>` only renders when `!asList` (`KnowledgeGraph.tsx:403`, `asList = phone &&
!canvas`), and `canvas` defaults to `false` — so the canvas frame does not exist in the DOM at
mount. The sizing effect that calls `measure()` (`KnowledgeGraph.tsx:173-192`) depends on
`[shown, animated, draw, measure]`, none of which change when the reader taps "Canvas"
(`KnowledgeGraph.tsx:368`, `setCanvas`) — so `sizeRef.current` is never corrected once the real,
narrow frame mounts. Every `defaultView`/`fitTo` call after that fits the layout to an assumed
900×520 frame while the SVG is actually ~380-430px wide, which both pushes content off the
visible edge (the ticket's "content runs outside the viewport... immediately on load" and
"clipped off the left edge") and inflates the apparent crowding on the part of the layout that
*is* visible, since the reader sees a cropped slice of a layout sized for a much wider frame.
`hullPath` (`lib/graph/hull.ts`) is a correct convex hull over whatever positions it is given;
the "poorly shaped, clipped hull" complaint is expected to be this same mismatch, not a hull bug
— task 6 confirms that with a screenshot before touching `hull.ts`.

Fix: re-measure whenever the canvas frame transitions from absent to present, not only from the
`[shown, animated]` effect. A `ResizeObserver` on `frameRef` (already conditionally mounted)
firing `measure()` + `draw()` on layout covers both this case and any future one (a container
resize, a sidebar opening) without another one-off effect dependency to remember.

## Risks / Trade-offs

- [Per-tick screen-space overlap detection could cost frames on a large graph] → Tried a
  time-based throttle first (recompute at most every ~120ms); dropped it after it made a drag's
  suppression verdict visibly stale in exactly the case that matters most (a drag lands two
  chips on top of each other and the reader expects the fade *now*, not on the next window).
  Running it every tick instead is the same order of work `forceCollide` already pays each tick
  (O(n²) pairs vs. its own near-O(n) collision grid) — at the "200 nodes / 600 edges" ceiling
  that is ~40k simple numeric comparisons a frame, negligible next to a 16ms budget. Revisit
  with an actual spatial bucket only if a real profile says otherwise.
- [Easing `clusterForce` by group size could loosen clustering enough to weaken the "structure
  reads by grouping" goal] → Tune against the existing spec scenario for cluster regions
  ("A group's cluster region") and re-check with the harness at the real 31/67 scale before
  and after.
- [I have not confirmed the blank-label severity against real production data] → Task 1 re-runs
  the harness with the closest obtainable approximation of the real graph shape and captures a
  screenshot before any other task starts; if that repro disagrees with this diagnosis, stop and
  raise it rather than build the rest of the change on a wrong premise.

## Migration Plan

Pure client-side rendering/layout change behind the existing `/knowledge/graph` read. No data
migration, no API change, no flag — ships in the same PR, verified with before/after phone
screenshots per the ticket's acceptance criteria. Nothing to roll back beyond reverting the PR.
