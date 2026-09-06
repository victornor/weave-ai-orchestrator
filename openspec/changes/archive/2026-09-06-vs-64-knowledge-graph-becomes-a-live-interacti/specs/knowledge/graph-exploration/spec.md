## Purpose

Defines how a person explores the knowledge graph in the web app: a layout that keeps
settling and survives a data refresh, nodes that can be moved and pinned, a viewport that
can be zoomed and panned, neighbourhood highlighting, a detail panel, search, filters and
project clusters — so that the shape of a workspace's memory can be read and interrogated
rather than only glanced at.

## ADDED Requirements

### Requirement: The layout is a live simulation

The graph SHALL be laid out by a force simulation that runs while the view is open and
continues to settle rather than being computed once and frozen. The simulation SHALL come to
rest when the layout has converged and SHALL resume whenever the graph is disturbed — by a
drag, by a filter change, or by new data.

While the view is not visible or is unmounted, the simulation SHALL NOT continue to consume
animation frames.

#### Scenario: The graph settles after opening

- **WHEN** the graph view is opened with nodes and edges
- **THEN** the nodes move from their starting positions towards a settled layout and the
  simulation stops running once it has converged

#### Scenario: The simulation stops with the view

- **WHEN** the graph view is closed or unmounted while the simulation is still running
- **THEN** the simulation is stopped and no further layout work is scheduled

### Requirement: A data refresh animates instead of jumping

When the graph data is refetched, every node that was already present SHALL keep the
position it currently occupies, and its pinned state SHALL be preserved. Nodes that are new
SHALL be introduced near the neighbours they link to rather than at an arbitrary point, and
nodes that have disappeared SHALL be removed. The simulation SHALL be reheated so the
adjusted layout is reached by animation.

#### Scenario: The same graph is refetched

- **WHEN** the graph data is refetched and the nodes and edges are unchanged
- **THEN** every node keeps its current position and the view does not jump

#### Scenario: A page is added

- **WHEN** a refetch adds a node that links to an existing node
- **THEN** the existing nodes keep their positions, the new node enters near the node it
  links to, and the layout settles again from there

### Requirement: Nodes can be dragged and pinned

A node SHALL be draggable with a mouse or with a finger. While it is being dragged it SHALL
follow the pointer, and the simulation SHALL stay warm so its neighbours re-flow around it.

Releasing a node SHALL let it settle with the rest of the graph unless it is pinned. A node
SHALL be pinnable and unpinnable, and a pinned node SHALL hold its position until it is
unpinned or dragged again. A pinned node SHALL be visually distinguishable from an unpinned
one.

Dragging a node SHALL NOT pan the viewport, and SHALL NOT be treated as a click that selects
or opens the node.

#### Scenario: Dragging a node

- **WHEN** a node is pressed and moved
- **THEN** it follows the pointer and its neighbours move in response

#### Scenario: Releasing an unpinned node

- **WHEN** a node that is not pinned is released
- **THEN** it settles into the layout with the other nodes

#### Scenario: Pinning a node

- **WHEN** a node is pinned and then released
- **THEN** it stays where it was put, is drawn as pinned, and the rest of the graph settles
  around it

#### Scenario: A drag is not a click

- **WHEN** a node is dragged beyond a small threshold and released
- **THEN** the node is not opened and the selection is unchanged

### Requirement: The viewport can be zoomed and panned

The graph SHALL be zoomable with the mouse wheel and with a two-finger pinch, and pannable
by dragging the background with a mouse or a finger. Zooming with a pointer SHALL keep the
point under the pointer in place. The zoom SHALL be bounded at both ends.

The view SHALL offer a **fit** control that frames every visible node, and a **reset**
control that returns the viewport to its default zoom and position. Opening the graph SHALL
start from a fitted view.

#### Scenario: Wheel zoom around the pointer

- **WHEN** the wheel is turned over a point in the graph
- **THEN** the view zooms and the graph point under the pointer stays under the pointer

#### Scenario: Pinch zoom

- **WHEN** two fingers move apart or together over the graph
- **THEN** the view zooms about the midpoint between them

#### Scenario: Panning the background

- **WHEN** the background is dragged
- **THEN** the whole graph translates with the pointer and no node is moved

#### Scenario: Fit to view

- **WHEN** the fit control is used
- **THEN** every visible node is inside the viewport with a margin, at a zoom within the
  allowed bounds

#### Scenario: Zoom is bounded

- **WHEN** zooming continues past the minimum or maximum
- **THEN** the zoom stops at the bound rather than continuing

### Requirement: Label detail follows the zoom

Node labels SHALL be rendered at a size that stays legible at every zoom level rather than
scaling with the view. The amount of label shown SHALL depend on the zoom: below a low
threshold only the labels of hub nodes and of the selected or hovered node are shown; at
intermediate zoom labels are shown truncated; above a high threshold labels are shown in
full.

#### Scenario: Zoomed far out

- **WHEN** the view is zoomed below the low threshold
- **THEN** only hub labels and the labels of the hovered or selected node are drawn

#### Scenario: Zoomed in

- **WHEN** the view is zoomed above the high threshold
- **THEN** every visible node's label is drawn in full and at the same on-screen text size
  as at any other zoom

### Requirement: Hovering highlights a neighbourhood

Hovering a node SHALL highlight that node, its direct neighbours, and the edges between
them, and SHALL dim every other node and edge. Moving away from the node SHALL restore the
undimmed view. A selection SHALL highlight the same neighbourhood when nothing is hovered.

#### Scenario: Hovering a node

- **WHEN** the pointer is over a node
- **THEN** that node, its direct neighbours and the edges joining them are drawn undimmed
  and everything else is dimmed

#### Scenario: Leaving a node

- **WHEN** the pointer leaves the node and nothing is selected
- **THEN** every node and edge returns to its normal appearance

### Requirement: Selecting a node opens a detail panel

Clicking a node SHALL select it and open a detail panel for it. The panel SHALL show the
node's title, its scope or project, its size in tokens, its number of links, and the list of
pages it links to and that link to it. The panel SHALL offer an action that opens the page,
a pin toggle for the node, and a way to focus a linked page in the graph. Closing the panel
SHALL clear the selection.

The action that opens a page SHALL open the same page the graph opened before this
capability existed, and double-clicking a node SHALL remain a shortcut for it.

#### Scenario: Selecting a node

- **WHEN** a node is clicked
- **THEN** it is drawn as selected and a panel shows its title, scope or project, token
  size, link count and linked pages

#### Scenario: Opening the page

- **WHEN** the panel's open action is used, or the node is double-clicked
- **THEN** the page for that node is opened, exactly as clicking the node did before

#### Scenario: Following a link from the panel

- **WHEN** a linked page is chosen in the panel
- **THEN** that node becomes the selected node and the view brings it into the viewport

### Requirement: Search finds and focuses nodes by title

The view SHALL offer a search box that matches nodes by title, case-insensitively, on a
substring. Nodes that match SHALL stay prominent and nodes that do not SHALL be dimmed
without being removed from the layout. When exactly one node matches, the view SHALL bring
it into the viewport. Clearing the search SHALL restore the undimmed view.

#### Scenario: A search with several matches

- **WHEN** a term matching more than one node title is entered
- **THEN** the matching nodes stay prominent, the rest are dimmed, and the layout is
  unchanged

#### Scenario: A search with one match

- **WHEN** a term matching exactly one node title is entered
- **THEN** that node is brought into the viewport

#### Scenario: Clearing the search

- **WHEN** the search box is emptied
- **THEN** every node returns to its normal appearance

### Requirement: Groups can be filtered and are drawn as clusters

Nodes SHALL be grouped by project, and by scope where a node belongs to no project. The view
SHALL show a legend naming every group with the colour used for it, and choosing a group in
the legend SHALL hide or show that group's nodes. A hidden group's nodes and the edges
touching them SHALL be excluded from the drawing and from the layout, and the remaining
graph SHALL settle again.

Each group of two or more visible nodes SHALL be drawn inside a translucent region in that
group's colour, behind the edges and nodes, that follows the group's nodes as they move.

#### Scenario: Hiding a group

- **WHEN** a group is switched off in the legend
- **THEN** its nodes and the edges touching them are no longer drawn and the rest of the
  graph settles into the space

#### Scenario: A group's cluster region

- **WHEN** a group has two or more visible nodes
- **THEN** a translucent region in that group's colour encloses them, behind the edges and
  nodes, and follows them as they move

#### Scenario: Every group hidden

- **WHEN** every group is switched off
- **THEN** the view says there is nothing to draw rather than showing an empty frame

### Requirement: Nodes and edges carry their meaning

A node's size SHALL encode its number of links, a node's colour SHALL encode its group, and
a hub file SHALL be drawn in a shape that distinguishes it from a document at a glance.

An edge SHALL be drawn with an arrowhead at its target when the link exists in one direction
only. When two pages link to each other, the pair SHALL be drawn as a single edge with no
arrowhead.

#### Scenario: A one-way link

- **WHEN** one page links to another and the second does not link back
- **THEN** the edge between them is drawn with an arrowhead pointing at the second page

#### Scenario: A reciprocal link

- **WHEN** two pages link to each other
- **THEN** they are joined by one edge with no arrowhead rather than two edges

#### Scenario: A hub among documents

- **WHEN** a hub file and a document are both drawn
- **THEN** they are distinguishable by shape, and each node's size reflects its number of
  links

### Requirement: The phone shows neighbours as a list, with the canvas available

Under the phone breakpoint the graph SHALL default to the neighbour list: the selected node
followed by its direct neighbours, one hop at a time, choosing a neighbour making it the
selected node. The view SHALL offer an explicit control that switches to the interactive
canvas, and on the canvas a finger SHALL drag a node, a finger on the background SHALL pan,
and two fingers SHALL pinch to zoom.

#### Scenario: Opening the graph on a phone

- **WHEN** the graph is opened under the phone breakpoint
- **THEN** the neighbour list is shown, with the selected node and its direct neighbours

#### Scenario: Walking the graph a hop at a time

- **WHEN** a neighbour is chosen in the list
- **THEN** it becomes the selected node and its own neighbours are listed

#### Scenario: Switching to the canvas on a phone

- **WHEN** the canvas control is used on a phone
- **THEN** the interactive graph is shown and responds to touch drag, touch pan and pinch
  zoom

### Requirement: Reduced motion is honoured

When the reader has asked for reduced motion, the layout SHALL be computed to convergence in
one pass and drawn once, with no continuous animation and no animated transitions of the
viewport. Every interaction SHALL still work: dragging a node SHALL move it, and releasing,
pinning, filtering or refetching SHALL settle the layout in one step rather than over time.

#### Scenario: Opening the graph with reduced motion

- **WHEN** the graph is opened and the reader prefers reduced motion
- **THEN** the settled layout is drawn immediately and no animation frames are scheduled

#### Scenario: Fitting the view with reduced motion

- **WHEN** the fit or reset control is used and the reader prefers reduced motion
- **THEN** the viewport changes in one step rather than animating

### Requirement: The graph stays responsive at workspace scale

The view SHALL remain interactive with at least 200 nodes and 600 edges: dragging, hovering,
zooming and panning SHALL continue to respond while the simulation runs. The graph
renderer SHALL NOT be loaded by pages that do not draw the graph.

#### Scenario: A large workspace graph

- **WHEN** a graph of 200 nodes and 600 edges is open
- **THEN** dragging, hovering, zooming and panning continue to respond while the layout
  settles

#### Scenario: Another page is opened

- **WHEN** a page other than the graph is loaded
- **THEN** the graph renderer and its layout library are not loaded

### Requirement: The graph follows the app's theme

Every colour the graph draws — nodes, edges, labels, cluster regions, highlight and dimming
— SHALL come from the app's design tokens, so that switching between the light and dark
themes restyles the graph with no other change.

#### Scenario: Switching theme

- **WHEN** the app is switched between its light and dark themes with the graph open
- **THEN** the graph's nodes, edges, labels and cluster regions take the new theme's colours
