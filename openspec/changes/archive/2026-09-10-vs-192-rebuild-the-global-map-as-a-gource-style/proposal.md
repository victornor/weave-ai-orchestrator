## Why

The Global Map (VS-176) currently renders as three colliding clusters of large, flat-coloured
shapes with unreadable overlapping labels and near-invisible edges — captain's own description,
from a phone screenshot. It reads as a pile of stickers, not a graph, and conveys nothing about the
system being alive. Captain wants a Gource-style look: a radial tree lit by thin luminous edges and
small glowing nodes, animating continuously, legible on a phone in portrait first.

## What Changes

- Replace the force-directed, chip-labelled rendering `MapCanvas` currently borrows from
  `lib/graph/*` with a dedicated radial-tree layout and renderer under `lib/map/`, used only by the
  global Map. `lib/graph/*` and the per-project knowledge graph that depends on it are untouched.
- New deterministic radial-tree layout: every node keeps the same single parent it already has in
  `MapModel`'s edges (the model is already a tree, not a general graph), placed by angle (siblings
  split their parent's angular span, weighted by descendant-leaf count) and by radius (fixed per
  depth: workspace → project/conductor → role/knowledge/unassigned-ticket → assigned ticket). Three
  workspaces therefore occupy three non-overlapping angular wedges of one shared centre by
  construction, rather than three independently drifting force clusters that can collide.
- New rendering treatment: thin bright edge strokes (with a soft double-stroke halo, no per-element
  blur filter) as the dominant visual; small circular leaf nodes with a radial-gradient bloom in
  place of today's large flat circles/squares/diamonds; branch nodes (workspace/project/conductor/
  role) a little larger, still small relative to today.
- New label decluttering: a node's label is drawn only if its estimated on-screen bounding box does
  not overlap an already-placed, higher-priority label (priority by kind, then by depth). Leaf nodes
  (ticket, knowledge) are unlabelled by default and show a label only when hovered/selected/dragged.
  This replaces the current zoom-based `labelDetail` (none/truncated/full) scheme for the Map only.
- New continuous motion: each node's drawn position is its fixed tree position plus a small,
  per-node deterministic sinusoidal drift (bounded well under half the minimum sibling separation,
  so drift can never cause an overlap), advanced by `requestAnimationFrame` — no physics
  simulation runs continuously, so there is no per-frame force computation to cost CPU on a phone.
  Reduced motion draws the static tree position with no drift and schedules no frames, as today.
- New colour treatment: branch node colour keeps per-workspace hue but darker/desaturated; ticket
  leaf colour uses the existing status tokens (already meaningful: working/blocked/needs-you/
  merging carry their own hue); knowledge and role node brightness reflects recency from each row's
  already-fetched `updatedAt`. All colour still comes from CSS custom properties (design tokens), so
  theme switching keeps restyling the graph with no other change, as the existing spec requires.
- New worker beam: a live worker (from the already-available per-workspace `/workers` list) is drawn
  as a small comet glyph travelling from its role's (or project's) position to the ticket node it
  holds, appearing when the worker becomes live and fading out over a short, fixed duration when it
  stops being live. This is a decorative overlay only — it does not add a graph node, does not
  affect layout, is not selectable, and is not part of node/edge counts. The existing "Workers SHALL
  NOT be nodes" requirement is unchanged; only a new requirement about this overlay is added.
- Dragging a node **BREAKING (behavioural)**: instead of repositioning the live force simulation
  (which no longer exists), a drag temporarily displaces the node under the pointer and it springs
  back to its tree position on release. Pan, wheel zoom, pinch zoom and Fit are unchanged.
- Existing filter row (Workspace/Project/Conductor/Role/Ticket/Knowledge kind toggles) and phone
  list/canvas toggle keep working, restyled to match, unchanged in behaviour.

## Capabilities

### New Capabilities
(none — this reshapes how the existing global Map capability renders and reacts; no new
addressable capability is introduced)

### Modified Capabilities
- `workspace-navigation/global-map`: layout is a radial tree instead of a force-directed graph
  with hulls; node and edge visual treatment changes (size, colour, glow); label display changes
  from zoom-based detail to collision-avoided decluttering, with leaf labels shown only on
  interaction; continuous drift replaces the settle-then-idle force simulation; node dragging
  springs back instead of repositioning permanently; a live worker gets a decorative beam to its
  ticket. Node/edge inclusion rules (which things get nodes, which edges connect them), the
  open-a-node navigation behaviour, the phone list/canvas toggle, the workspace-load error/empty
  states, and the theme-token requirement are unchanged and keep their existing scenarios.

## Impact

- `packages/ui/src/routes/MapCanvas.tsx` — rewritten against the new `lib/map/*` layout and
  renderer instead of `lib/graph/*`.
- `packages/ui/src/lib/map/model.ts` — extended (not restructured): `MapNode` gains the fields the
  new renderer needs (`updatedAt`, ticket `status`, a `hasLiveWorker`-style activity flag) sourced
  from data the route already fetches; no new HTTP calls, no backend or schema change.
- `packages/ui/src/routes/GlobalMap.tsx` — gains one more already-existing hook call
  (`useWorkersMany`, used elsewhere for the board) to supply the worker-beam overlay; otherwise
  unchanged.
- New files under `packages/ui/src/lib/map/`: radial layout, drift, label decluttering, and the
  worker-beam overlay — all pure and unit-testable, none imported by `KnowledgeGraph.tsx` or
  `lib/graph/*`.
- `packages/ui/src/lib/graph/*` and `packages/ui/src/routes/KnowledgeGraph.tsx` are not touched.
- No new runtime dependency: the radial-tree partition is small enough to hand-roll rather than
  add `d3-hierarchy`; `d3-force` stays a dependency for the knowledge graph only.
- Test files `globalMap.test.tsx` and `mapModel.test.ts` are updated for the new model fields and
  rendering; new test files for the layout/drift/label/beam modules.
