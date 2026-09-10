## ADDED Requirements

### Requirement: The layout is a radial tree rooted at the instance

The graph SHALL be laid out as a radial tree: an unrendered instance root at the centre, workspace
nodes placed around it, and every other node placed at a radius determined by its depth below its
workspace (project and conductor nearer the centre; role, unassigned ticket and knowledge further
out; a ticket assigned to a role furthest out). Each node's angular position SHALL fall strictly
within its parent's angular span, and siblings SHALL NOT share angular space, so that two nodes with
different parents never occupy the same direction from the centre at the same radius.

Because each workspace's whole subtree is confined to its own angular span from the shared centre,
two workspaces' subtrees SHALL NOT visually overlap regardless of how many nodes either one has.

#### Scenario: Three workspaces do not collide

- **WHEN** the daemon hosts three workspaces, each with its own projects, roles and in-flight
  tickets, and the global Map is open
- **THEN** each workspace and everything under it occupies its own angular wedge from the shared
  centre, and no node from one workspace's wedge overlaps a node from another's

#### Scenario: Hierarchy is readable without labels

- **WHEN** the global Map is open at its fitted view
- **THEN** a workspace's projects sit strictly closer to the centre than that workspace's roles,
  and that workspace's roles sit strictly closer to the centre than tickets assigned to them,
  independent of any label being read

### Requirement: Edges and nodes read as a luminous graph, not filled shapes

Edges SHALL be drawn as thin strokes rendered brighter than the background and brighter than node
fills, so that the branching structure is the most visually dominant element of the page. A node
SHALL be drawn as a small filled circle with a soft glow around it; the largest node on the page
SHALL occupy a small fraction of the canvas, never dominating it the way a workspace node did
before this change.

A node's brightness SHALL reflect its own recency or activity: a ticket node's colour SHALL reflect
its status (the same status colours used elsewhere in the app); a role or knowledge node that has
changed more recently, or a project or workspace with active work under it, SHALL render brighter
than one that has not. All colour SHALL still come from the app's design tokens.

#### Scenario: Edges are the dominant visual element

- **WHEN** the global Map is drawn
- **THEN** every edge is rendered as a bright thin stroke and no node fill is large or opaque enough
  to visually dominate the edges connecting it

#### Scenario: A ticket's colour matches its status

- **WHEN** a ticket node is `blocked` and another is `in_progress`
- **THEN** the two nodes are rendered in their respective status colours from the app's design
  tokens

#### Scenario: A recently updated node renders brighter

- **WHEN** a role's knowledge or ticket activity has updated more recently than a sibling role's
- **THEN** the more recently updated role's node renders brighter than the sibling's

### Requirement: Labels never overlap

A node's label SHALL be drawn only if its on-screen bounding box does not overlap any
already-drawn, higher-priority label's bounding box at the current zoom. Priority SHALL run from a
workspace's label (highest) down through project, conductor, role, to ticket and knowledge (lowest).
A ticket or knowledge node's label SHALL NOT be drawn by default; it SHALL be drawn only while that
node is hovered, selected, or dragged, and even then SHALL be suppressed if it would overlap a
higher-priority label already shown.

#### Scenario: A lower-priority label yields

- **WHEN** a role's label and a ticket's label would overlap on screen
- **THEN** the role's label is shown and the ticket's label is suppressed

#### Scenario: A leaf label appears on interaction

- **WHEN** a ticket node is hovered
- **THEN** its label is drawn unless doing so would overlap an already-shown higher-priority label

#### Scenario: No two shown labels overlap

- **WHEN** the global Map is drawn at any zoom within its bounds
- **THEN** no two simultaneously drawn labels' bounding boxes overlap on screen

### Requirement: The graph drifts continuously without a running simulation

Once laid out, each node SHALL continue a small, bounded, per-node motion around its tree position
for as long as the page is open, so the graph reads as alive rather than static. This motion SHALL
NOT be produced by a physics simulation that runs every frame; it SHALL be cheap enough that the
page stays smooth on a phone. The motion SHALL be small enough that it cannot cause two nodes' drawn
positions to collide.

When the reader has asked for reduced motion, this drift SHALL NOT run, consistent with the
existing requirement that reduced motion draws the layout in one pass with no animation frames.

#### Scenario: The graph keeps moving at rest

- **WHEN** the global Map has been open and idle for several seconds
- **THEN** node positions have visibly shifted from their initial tree position, within a bounded
  distance, without any new data having arrived

#### Scenario: Drift never causes an overlap

- **WHEN** two sibling nodes are at their closest allowed tree positions
- **THEN** their drift never brings their drawn shapes into contact

### Requirement: A live worker draws a fading beam to its ticket

While a worker is live and holds an in-flight ticket, the global Map SHALL draw a small glyph
travelling from near that ticket's role (or project, if the ticket has no role) to the ticket's
node, as a visual beam distinct from the graph's edges. The beam SHALL appear when the worker
becomes live and SHALL fade out over a short, fixed duration once the worker is no longer live. This
beam is decorative only: it SHALL NOT be a selectable node, SHALL NOT be counted among the graph's
nodes or edges, and SHALL NOT affect the layout of any node.

#### Scenario: A worker's beam appears

- **WHEN** a worker starts a turn on an in-flight ticket that has a node on the map
- **THEN** a beam appears travelling toward that ticket's node

#### Scenario: A worker's beam fades on retirement

- **WHEN** a worker holding a ticket's beam retires
- **THEN** the beam fades out over a short fixed duration and then is gone

#### Scenario: A beam is not a node

- **WHEN** a worker's beam is showing
- **THEN** it cannot be selected, does not appear in the neighbour list, and is absent from the
  graph's node and edge counts

### Requirement: Dragging a node plucks it and it springs back

Dragging a node SHALL temporarily displace it from its tree position, following the pointer.
Releasing it SHALL animate it back to its tree position (adjusted for any drift at that moment)
rather than leaving it at the dropped point. This SHALL NOT alter the tree layout or any other
node's position.

#### Scenario: A dragged node returns

- **WHEN** a node is dragged away from its position and released
- **THEN** it animates back to its tree position rather than staying where it was dropped

#### Scenario: Dragging one node does not move others

- **WHEN** a node is being dragged
- **THEN** no other node's position changes because of it
