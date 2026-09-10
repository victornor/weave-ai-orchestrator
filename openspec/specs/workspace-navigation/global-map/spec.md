# workspace-navigation/global-map Specification

## Purpose
A daemon-wide Map page that graphs every workspace this daemon hosts — its projects, roles,
in-flight tickets and knowledge — reachable without picking a workspace first, so the shape of the
whole instance can be read at a glance.

## Requirements

### Requirement: A global Map page graphs every hosted workspace

The web app SHALL provide an addressable Map page at a path that does not include a workspace id,
reachable from the sidebar's global section and from the phone's More menu, without typing a URL
and without first choosing a workspace.

The page SHALL draw one graph whose nodes and edges cover every workspace this daemon hosts. Opening
the page SHALL NOT make a workspace the active one. Per-workspace pages SHALL keep working unchanged.
The per-project knowledge graph SHALL keep working unchanged.

#### Scenario: Opening global Map from the sidebar

- **WHEN** the human activates Map in the sidebar's global section
- **THEN** the app shows the global Map page without a document reload and without making a
  workspace the active one

#### Scenario: Opening global Map from a phone

- **WHEN** the human opens More on a phone and chooses the global Map destination
- **THEN** the app shows the global Map page and the menu is dismissed

#### Scenario: Two workspaces appear together

- **WHEN** the daemon hosts workspace Alpha and workspace Beta, and global Map is open
- **THEN** the graph contains a workspace node for Alpha and a workspace node for Beta

#### Scenario: Per-workspace pages are unchanged

- **WHEN** the human activates Knowledge inside a workspace group's section list
- **THEN** the app shows that workspace's Knowledge page, not the global Map

### Requirement: Nodes are workspaces, projects, roles, in-flight tickets and knowledge

The graph SHALL include, for each hosted workspace that has loaded:

- one **workspace** node, named with the workspace's name;
- one **project** node per project in that workspace, named with the project's slug;
- one **conductor** node for that workspace's conductor, when the conductor exists;
- one **role** node per hired role that is not `retired`, named with the role's name, including
  roles whose status is `pending_activation` or `paused`;
- one **ticket** node per in-flight ticket, named with the ticket's identifier and title.
  In-flight means the ticket's status is one of `proposing`, `proposed`, `approved`, `in_progress`,
  `in_review`, `merging`, or `blocked`. Tickets in `backlog`, `todo`, `done` or `cancelled` SHALL
  NOT have a node;
- one **knowledge** node per project that has at least one knowledge file, and one knowledge node
  for workspace-scope knowledge when that workspace has knowledge files that belong to no project.
  A knowledge node SHALL represent that project's (or the workspace's) knowledge as a whole, not
  each document.

Workers SHALL NOT be nodes. A ticket that a live worker currently holds MAY name that worker on the
ticket node, but the worker is not a separate node.

Each node kind SHALL be distinguishable by shape or colour from the other kinds, using the app's
design tokens.

#### Scenario: A workspace with a project, a role and a running ticket

- **WHEN** workspace Alpha has project `api`, a hired role "Platform Engineer" on that project, and
  ticket VS-176 in `in_progress` assigned to that role
- **THEN** the graph contains nodes for Alpha, `api`, the role, and VS-176

#### Scenario: A todo ticket is not on the map

- **WHEN** a ticket in any hosted workspace is in `todo`
- **THEN** that ticket has no node on the global Map

#### Scenario: A done ticket is not on the map

- **WHEN** a ticket in any hosted workspace is in `done`
- **THEN** that ticket has no node on the global Map

#### Scenario: Knowledge is one node per project, not every document

- **WHEN** project `api` has a hub file and three documents
- **THEN** the graph has one knowledge node for `api`, not four

#### Scenario: A worker is not a node

- **WHEN** a live worker holds an in-flight ticket
- **THEN** the graph has a node for the ticket and for the role, and no node for the worker

#### Scenario: A retired role is not a node

- **WHEN** a role in any hosted workspace is `retired`
- **THEN** that role has no node on the global Map

### Requirement: Edges make ownership obvious

The graph SHALL draw an edge:

- from a workspace node to each of that workspace's project nodes;
- from a workspace node to that workspace's conductor node;
- from a project node to each of that project's role nodes;
- from a role node to each in-flight ticket assigned to that role;
- from a project node to each of that project's in-flight tickets that have no assignee role;
- from a project node to that project's knowledge node;
- from a workspace node to that workspace's workspace-scope knowledge node, when it exists.

The graph SHALL NOT draw an edge that crosses workspaces.

#### Scenario: A ticket hangs off its role

- **WHEN** VS-176 is in `in_progress` and assigned to role "Platform Engineer" in project `api` of
  workspace Alpha
- **THEN** the graph has edges Alpha→`api`, `api`→Platform Engineer, and Platform Engineer→VS-176

#### Scenario: An unassigned in-flight ticket hangs off its project

- **WHEN** a ticket in `blocked` belongs to project `api` and has no assignee role
- **THEN** the graph has an edge from `api` to that ticket, and no role-to-ticket edge for it

#### Scenario: Knowledge hangs off its project

- **WHEN** project `api` has a knowledge node
- **THEN** the graph has an edge from `api` to that knowledge node

### Requirement: Opening a node reaches that thing in its workspace

Selecting a node SHALL mark it as selected and SHALL show a detail panel naming the node, its kind,
and its workspace. The panel SHALL offer an action that opens the thing the node represents, in
that thing's workspace. Double-clicking a node SHALL be a shortcut for that action.

Opening SHALL navigate within the running application without a document reload, and SHALL make
that workspace the active one — the human has left the global page.

- A workspace node SHALL open that workspace's Needs you page.
- A project node SHALL open that project's overview.
- A role node SHALL open that workspace's Team page.
- A conductor node SHALL open that workspace's Chat page.
- A ticket node SHALL open that ticket.
- A knowledge node SHALL open that workspace's Knowledge page; a project knowledge node SHALL open
  it on that project.

Closing the panel SHALL clear the selection. Opening SHALL NOT edit knowledge.

#### Scenario: Opening a ticket from the map

- **WHEN** the human activates the open action on ticket VS-176's node, whose workspace is Alpha
- **THEN** the app shows VS-176 in Alpha and Alpha becomes the active workspace

#### Scenario: Opening a project from the map

- **WHEN** the human double-clicks project `api`'s node in workspace Alpha
- **THEN** the app shows `api`'s overview in Alpha

#### Scenario: Knowledge is not edited from the map

- **WHEN** the human opens a knowledge node
- **THEN** the app shows that knowledge page and does not present an editor on the map itself

### Requirement: The viewport can be zoomed, panned and fitted

The graph SHALL be zoomable with the mouse wheel and with a two-finger pinch, and pannable by
dragging the background with a mouse or a finger. Zooming with a pointer SHALL keep the point under
the pointer in place. The zoom SHALL be bounded at both ends.

The view SHALL offer a **fit** control that frames every visible node. Opening the graph SHALL
start from a fitted view. Node labels SHALL stay legible at every zoom rather than scaling with
the view, so nodes are never unreadable tiny blobs.

Dragging a node SHALL NOT pan the viewport. Dragging the background SHALL NOT move a node.

#### Scenario: Wheel zoom around the pointer

- **WHEN** the wheel is turned over a point in the map
- **THEN** the view zooms and the graph point under the pointer stays under the pointer

#### Scenario: Panning the background

- **WHEN** the background is dragged
- **THEN** the whole graph translates with the pointer and no node is moved

#### Scenario: Fit to view

- **WHEN** the fit control is used
- **THEN** every visible node is inside the viewport with a margin, at a zoom within the allowed
  bounds

#### Scenario: Labels stay legible when zoomed out

- **WHEN** the view is zoomed toward the minimum
- **THEN** visible node labels remain at a readable on-screen size rather than shrinking with the
  view

### Requirement: Empty workspaces do not break the page

A workspace that has no projects, no roles and no in-flight tickets SHALL still appear as a
workspace node and SHALL NOT show an error of its own. While any workspace's map data has not yet
loaded, the page SHALL show a loading state distinguishable from empty. When every workspace has
loaded and the daemon hosts none, the page SHALL show a worded empty state. When one workspace's
data cannot be loaded, the page SHALL keep showing nodes from the workspaces that did load and
SHALL show that the failed workspace could not load, with a way to retry that workspace; it SHALL
NOT blank the whole page. When the workspace list itself cannot be loaded, the page SHALL show an
error and a way to retry.

When a project, role, in-flight ticket or knowledge file appears or disappears in any workspace, the
corresponding node SHALL appear or disappear without a document reload.

#### Scenario: An empty workspace still has a node

- **WHEN** workspace Beta has loaded with no projects, no roles and no in-flight tickets, and Alpha
  has a project
- **THEN** the graph shows Beta's workspace node, Alpha's nodes, and no error for Beta

#### Scenario: Nobody is hosted

- **WHEN** the workspace list has loaded and the daemon hosts no workspaces
- **THEN** the page says so in words, with no graph nodes

#### Scenario: One workspace fails to load

- **WHEN** workspace Alpha's map data fails to load and workspace Beta's has loaded with a project
- **THEN** the page shows Beta's nodes, shows that Alpha could not load, and offers retry for Alpha

#### Scenario: The map is still loading

- **WHEN** global Map is open and at least one workspace's map data has not arrived
- **THEN** the page shows a loading state, not the empty state

#### Scenario: A ticket starts in another workspace

- **WHEN** a ticket in any hosted workspace becomes in-flight while global Map is open
- **THEN** a node for that ticket appears without a reload

### Requirement: The phone shows neighbours as a list, with the canvas available

Under the phone breakpoint the map SHALL default to the neighbour list: the selected node followed
by its direct neighbours, one hop at a time, choosing a neighbour making it the selected node. The
view SHALL offer an explicit control that switches to the interactive canvas, and on the canvas a
finger SHALL drag a node, a finger on the background SHALL pan, and two fingers SHALL pinch to zoom.

#### Scenario: Opening the map on a phone

- **WHEN** the map is opened under the phone breakpoint
- **THEN** the neighbour list is shown, with the selected node and its direct neighbours

#### Scenario: Walking the map a hop at a time

- **WHEN** a neighbour is chosen in the list
- **THEN** it becomes the selected node and its own neighbours are listed

#### Scenario: Switching to the canvas on a phone

- **WHEN** the canvas control is used on a phone
- **THEN** the interactive graph is shown and responds to touch drag, touch pan and pinch zoom

### Requirement: Reduced motion is honoured and the graph follows the theme

When the reader has asked for reduced motion, the layout SHALL be drawn in one pass, with no
continuous animation and no animated transitions of the viewport. Every interaction SHALL still
work.

Every colour the graph draws SHALL come from the app's design tokens, so that switching between the
light and dark themes restyles the graph with no other change.

The graph renderer SHALL NOT be loaded by pages that do not draw a graph.

#### Scenario: Opening the map with reduced motion

- **WHEN** the map is opened and the reader prefers reduced motion
- **THEN** the settled layout is drawn immediately and no animation frames are scheduled

#### Scenario: Switching theme

- **WHEN** the app is switched between its light and dark themes with the map open
- **THEN** the graph's nodes, edges and labels take the new theme's colours

#### Scenario: Another page is opened

- **WHEN** a page other than the map or the per-project knowledge graph is loaded
- **THEN** the graph renderer and its layout library are not loaded

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
