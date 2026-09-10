## Context

See `proposal.md` for the why. Relevant current state:

- `packages/ui/src/lib/map/model.ts` already builds a **tree**, not a general graph: every node
  pushed by `buildMapModel` gets exactly one incoming edge (from its one parent) except the
  workspace nodes, which are the tree's own roots. `MapEdge` and `neighbours` exist for the
  neighbour-list and hover-highlight UI, not because the data is graph-shaped.
- `MapCanvas.tsx` currently converts `MapModel` into a `lib/graph/GraphModel` and runs the
  `d3-force` simulation from `lib/graph/simulation.ts` (chip-sized nodes, cluster force pulling
  each workspace's nodes toward their own centroid, collide, link, charge). That machinery is
  shared with `KnowledgeGraph.tsx` and is explicitly out of scope for this ticket — it stays as is.
- `lib/graph/viewport.ts` (pan/zoom/pinch/fit, `Point`/`Size`/`Bounds`, `toSvg`) is generic pure
  geometry with no dependency on the force simulation or on `GraphModel`. It is reused unchanged.
- The route (`GlobalMap.tsx`) already fetches, per workspace: projects, roles, tickets, knowledge
  index (`KnowledgeFile[]`, which carries `updatedAt`), and the conductor. `Role` and `Ticket` also
  carry `updatedAt`. `Project` does not carry any timestamp. Worker data
  (`useWorkersMany` → `WorkerListItem[]`, already used by the board/Live page) is not fetched here
  yet but requires no new endpoint.
- Design tokens available today (`index.css`): `--bg-0`, `--line-3`, `--text-1..4`, `--accent*`,
  and the nine `--status-*` hues (`idle`, `working`, `stalled`, `blocked`, `needs-you`, `merging`,
  `done`, `failed`, `paused`), all themed for light and dark.

## Goals / Non-Goals

**Goals:**
- A layout that structurally guarantees workspace subtrees never overlap, at any node count near
  today's (40-60 nodes, 3 workspaces).
- A renderer that is cheap enough to animate continuously on a phone: no per-frame physics.
- Every visual decision (sizes, colours, motion, label rules) fixed here, in pixels/graph-units and
  named tokens, so nothing is invented during apply.

**Non-Goals:**
- Replaying history over time (explicitly out of scope on the ticket).
- Changing `lib/graph/*` or `KnowledgeGraph.tsx`.
- Any backend, API or schema change. Everything the renderer needs comes from data the route
  already fetches, read more fully than today.
- A generic reusable "radial tree" library for other graphs. This is Map-specific; if the knowledge
  graph wants the same treatment later, that is a separate ticket that can choose to share code.

## Decisions

### 1. Hand-rolled radial tree layout, not `d3-hierarchy`

`MapModel` is already a tree. A radial "tidy tree" for a shallow, small tree (depth ≤ 4, ≤ ~60
nodes) is straightforward to hand-roll: give every node an angular span proportional to its
subtree's leaf count, recurse. This avoids adding `d3-hierarchy` as a new dependency for a problem
small enough not to need it, and gives full control over the one thing that needs tuning by hand —
minimum angular gap so labels don't collide (see Decision 3).

**New pure module** `lib/map/radial.ts`:

```
interface RadialNode { id: string; depth: number; angle: number; radius: number; x: number; y: number }
function layoutRadial(model: MapModel): Map<string, RadialNode>
```

Algorithm:
1. Build a `Map<parentId, childId[]>` from `model.edges` (each node has exactly one parent edge
   except workspaces, whose parent is a synthetic, undrawn root at `(0,0)`).
2. `leafCount(id)`: memoised recursive count, minimum 1 (a childless node counts as its own leaf).
3. `assign(id, angleStart, angleEnd)`: this node's angle is the midpoint of its span. Split the
   remaining span among children proportional to `leafCount(child)`, each child's span floored at
   `MIN_LEAF_ANGLE` (see Decision 3) before proportional distribution of the remainder, left to
   right in the model's existing node order (already deterministic: projects, then roles, then
   tickets, then knowledge, per `buildMapModel`).
4. Radius per depth is fixed, not computed: `RING_RADIUS = [0, 96, 176, 256, 336]` graph units for
   depth 0 (root, undrawn) through 4 (assigned ticket). A node's `x, y` are
   `radius * cos(angle) , radius * sin(angle)` — full 0..2π sweep (not a semicircle), so a portrait
   phone viewport is used on every side, not just top-to-bottom.
5. Workspaces (depth 1) split the full 2π among themselves the same way, proportional to their own
   leaf counts, with a fixed minimum gap between adjacent workspaces (`WORKSPACE_GAP = 0.12` rad)
   so two workspaces are never visually adjacent even at small counts.

This runs once per data change (React `useMemo` keyed on the built `MapModel`), not per frame.

### 2. Motion is drift, not a running simulation

Each node's **drawn** position is `radial position + drift(id, t)`, computed in a single
`requestAnimationFrame` loop that writes SVG `transform` attributes directly (same technique
`MapCanvas` already uses to avoid a React re-render per tick). `drift`:

```
drift(id, t) = amplitude(depth) * (sin(t * freq(id) + phase(id)), cos(t * freq(id) * 0.87 + phase(id)))
```

`phase(id)` and a small `freq` jitter (±15%) are derived once from a hash of the node id (same
technique as the existing `angleOf()` in `lib/graph/simulation.ts`, copied rather than imported —
one 8-line pure function, not worth a cross-module dependency for this alone). `amplitude(depth)`
is fixed per depth (`[0, 6, 10, 14, 16]` graph units, depth 0 unrendered) and is capped at build
time to `0.4 * (half the smallest angular*radius sibling gap at that depth)`, so drift can never
close the gap between two siblings — this is what makes the "drift never causes an overlap"
requirement true by construction rather than by tuning.

One `requestAnimationFrame` loop drives every node each frame with pure trig — no allocation, no
force iteration, no `d3-force`. Reduced motion (`prefers-reduced-motion`, already read via the
existing `useMediaQuery` hook in `MapCanvas.tsx`) skips starting the loop entirely and renders the
static radial position, matching the existing reduced-motion requirement.

Edges are redrawn from the same per-frame node positions (a `path` from parent to child, both ends
already computed).

### 3. Label decluttering: priority pass over screen-space rectangles

Recomputed only on data change and on zoom change (not every drift frame — drift amplitude is
small enough that a label computed against the undrifted radial position stays valid; recomputing
every frame would flicker labels in and out and cost more than it is worth):

1. Order candidate nodes: workspace, then project, then conductor, then role (only if
   `detail !== 'none'` — the existing zoom-based legibility floor from `lib/graph/viewport.ts`
   still governs whether labels are attempted at all at very small zoom), then, only for a node
   that is hovered/selected/dragged, ticket or knowledge.
2. For each, in order, estimate its screen-space bounding box from the current zoom's fixed label
   font size and the label text length (same estimate `chipSize()` already uses:
   `charWidth * text.length`, no DOM measurement — cheap and good enough for a decluttering
   heuristic).
3. Keep the label if its box does not intersect any already-kept box; otherwise mark it suppressed.
4. Cache the resulting `Set<string>` of shown-label ids; the render pass just checks membership.

This is O(n²) box-intersection over ≤ ~60 candidates, run only on data/zoom change — negligible.

### 4. Rendering: gradients and doubled strokes instead of blur filters

No project in this codebase uses `feGaussianBlur` yet, and per-node SVG filter regions are the
classic way to make an SVG scene expensive on mobile (each one forces its own offscreen raster).
Instead:

- **Node glow**: two concentric circles per node — a small solid core (radius per kind, see below)
  and a larger circle filled with a `radialGradient` from the node's colour at ~35% opacity fading
  to transparent. One `<radialGradient>` per distinct colour is defined once in `<defs>` and
  referenced by every node of that colour (`fill="url(#glow-<colour-key>)"`), so the gradient count
  is bounded by the palette, not by node count.
- **Edge glow**: two stacked `<path>`s per edge, both using the same `d`: a wide, low-opacity
  stroke underneath (the "halo") and a thin, brighter stroke on top (the "wire"). Both are cheap
  vector strokes, no filter.

Sizes (graph units, core circle radius): workspace 10, project 7, conductor 7, role 5, ticket 3.5,
knowledge 3.5 — all governed by fixed per-kind constants, not by `chipSize()`. The halo radius is
~2.5x the core. For comparison, today's `nodeRadius()` for a hub-kind chip is routinely 24-40+
units — the brief's "a fraction of what it is now" is satisfied by roughly an order of magnitude on
the core, more on the filled area.

### 5. Colour: hue by workspace and kind, brightness by activity/recency

- Workspace hue: reuse `projectColorVar(id, siblingIds)` (`lib/projectColor.ts`, VS-149/VS-173) —
  it is already a generic "stable colour for this id among these siblings" assignment over the
  five `--project-*` tokens, not tied to projects specifically — applied to workspace ids among
  the daemon's other workspace ids, rather than inventing a second palette. Branch nodes
  (workspace/project/conductor/role) render that colour darkened/desaturated toward `--bg-0` via a
  fixed CSS `color-mix()`, so it stays legible on both themes without a second set of hand-picked
  colours. A project keeps its own `projectColorVar` result (among its workspace's sibling
  projects) rather than inheriting its workspace's colour, so projects within one workspace stay
  distinguishable from each other too.
- Ticket node colour: the ticket's own status token (`--status-working`, `--status-blocked`, etc.)
  — already exactly the "recency/activity" signal the brief asks for, and already themed.
- Role/knowledge node brightness: `updatedAt` compared against the set of all sibling
  `updatedAt`s at load time, mapped to an opacity multiplier on the glow (not the hue) — freshest
  sibling at full glow opacity, oldest at a fixed floor (0.35), linearly interpolated. Recomputed
  on data refetch only.
- Project/workspace node brightness: floor raised (not to full) when any descendant ticket is
  in-flight or any descendant role has a live worker — both already knowable from data the route
  fetches (tickets, and the new worker fetch) — no new field, just a derived boolean folded in when
  building the render model.

### 6. Worker beam: a decorative overlay, not a graph node

`GlobalMap.tsx` adds one more `useWorkersMany(ids)` call (same hook the board already uses) and
passes live workers (`kind === 'worker' && isLiveWorker(status)`, reusing the existing predicate
from `lib/board.ts` rather than redefining it) down to `MapCanvas`. A new pure module
`lib/map/beams.ts` maps each live worker with a `ticketId` that has a node on the map to a `Beam`:

```
interface Beam { workerId: string; from: string /* node id */; to: string /* ticket node id */; bornAt: number }
```

`from` is the ticket's role node if present, else its project node, else its workspace node — the
same parent-resolution `buildMapModel` already does for the ticket's edge, so a beam always
originates from a node that exists. Beams render as a small circle animated along the straight line
from `from` to `to`'s current (drifting) position, looping every ~1.4s while the worker stays live.
When a worker drops out of the live set (retires, pauses — `pausedWorkersByTicket` is a separate
map already, a paused worker is not live, matching the existing board semantics), its beam is kept
in local component state with a `diedAt` timestamp and fades its opacity to 0 over 600ms before
being dropped — a plain `setTimeout`-driven state update, not a persisted anything.

Beams are drawn in their own `<g>`, are not part of `MapModel`, carry no `data-node`, and are
invisible to the existing pointer-hit-testing (`[data-node]` lookup), the neighbour list, and node
counts — satisfying "a beam is not a node" directly by construction.

### 7. Node drag: pluck and spring back

`MapCanvas` keeps its existing pointer-gesture code path (`gestureRef`, `pointersRef`) for
distinguishing a node-drag from a background-pan. Instead of feeding a `d3-force` simulation's
`fx`/`fy` (which no longer exists), a dragged node's position is held at the pointer in local
per-node override state; on release, a short (`~260ms`, reusing the existing `VIEW_TWEEN_MS`-style
ease-out already used for view tweening) animation interpolates from the drop point back to
`radial position + drift(id, now)`, then the override is cleared and the node rejoins the
drift-driven `requestAnimationFrame` loop. No other node is touched by this, since there is no
shared simulation state to disturb.

## Risks / Trade-offs

- **[Risk] Hand-rolled angle partition could still let very long labels overlap even with box
  decluttering being "only on zoom/data change".** → Mitigation: Decision 3's suppression pass is
  the actual guarantee (it runs after layout, in screen space, and hides whichever label loses);
  the layout-time minimum gap is only a first line of defence to keep suppression rare, not the
  correctness mechanism. The spec's "Labels never overlap" scenarios are about the suppression
  behaviour, not the layout spacing.
- **[Risk] Brightness-by-recency for role/knowledge nodes needs at least one sibling to compare
  against; a lone child has nothing to be relatively brighter or dimmer than.** → Mitigation: a
  single-sibling group renders at full glow opacity (the "freshest" case), which is also the
  simplest and least surprising default.
- **[Risk] Dropping the diamond/square node shapes (workspace/conductor were diamonds, knowledge
  was a square) in favour of uniform circles could read as "distinguishability regressed".** →
  Mitigation: the existing requirement says "distinguishable by shape **or** colour"; kind is now
  legible from radius, colour and, for branch kinds, an always-shown label, and primarily from tree
  depth itself (a workspace is always depth 1, a project always depth 2, etc.) — position alone
  already carries kind, which the old force layout could never guarantee.
- **[Trade-off] The pluck-and-spring-back drag no longer lets a reader permanently rearrange the
  graph to declutter a busy area by hand**, which the old force simulation incidentally allowed.
  Accepted: the brief asks for a self-organizing layout, and permanent manual rearrangement fought
  the "hierarchy is legible from the layout alone" goal by letting the layout drift from the
  hierarchy over a session.

## Migration Plan

Pure frontend change behind no flag. `MapCanvas.tsx` and `lib/map/model.ts` change in place;
`lib/graph/*` and `KnowledgeGraph.tsx` are untouched, so there is no migration for the knowledge
graph and no data migration of any kind. Ship as one PR; rollback is a plain revert.
