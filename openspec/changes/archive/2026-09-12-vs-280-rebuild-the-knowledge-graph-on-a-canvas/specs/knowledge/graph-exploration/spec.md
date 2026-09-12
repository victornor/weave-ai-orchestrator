## MODIFIED Requirements

### Requirement: The viewport can be zoomed and panned

The graph SHALL be zoomable with the mouse wheel, with a two-finger pinch, and pannable by
dragging the background with a mouse or a finger. Zooming with a pointer SHALL keep the point
under the pointer in place. The zoom SHALL be bounded at both ends.

The canvas SHALL own wheel, pinch and drag input for zoom and pan from the moment it exists in the
page, rather than attaching a listener after first paint that competes with the page for the
gesture. A wheel gesture over the graph SHALL zoom the graph and SHALL NOT scroll the surrounding
page.

Opening the graph SHALL start from a readable default zoom, centred on the layout, at which node
titles are visible — not from a fitted overview that shrinks the whole graph into the frame. The
view SHALL NOT require a dedicated zoom-in, zoom-out, fit or reset control to be usable: wheel
zoom, pinch zoom and background drag are sufficient on their own to reach and hold any view the
reader needs.

#### Scenario: Wheel zoom around the pointer

- **WHEN** the wheel is turned over a point in the graph
- **THEN** the view zooms and the graph point under the pointer stays under the pointer

#### Scenario: A wheel gesture does not scroll the page

- **WHEN** the wheel is turned over the graph, including immediately after the graph first mounts
- **THEN** the graph zooms and the surrounding page does not scroll instead

#### Scenario: Pinch zoom

- **WHEN** two fingers move apart or together over the graph
- **THEN** the view zooms about the midpoint between them

#### Scenario: Panning the background

- **WHEN** the background is dragged
- **THEN** the whole graph translates with the pointer and no node is moved

#### Scenario: Zoom is bounded

- **WHEN** zooming continues past the minimum or maximum
- **THEN** the zoom stops at the bound rather than continuing

#### Scenario: Opening at a readable zoom

- **WHEN** the graph view is opened with nodes
- **THEN** the viewport is at a zoom where node titles are visible, not fitted so
  tightly that nodes read as unmarked blobs

<!-- The three scenarios below are named for controls this change removes (see the requirement
     text above). Names are kept for spec history per this project's convention; each now
     describes the wheel/pinch/drag behaviour that makes the named control unnecessary, rather
     than the control itself. -->

#### Scenario: Fit to view

- **WHEN** the graph is opened
- **THEN** it starts at a zoom that already frames the settled layout closely enough to read,
  with no separate fit action needed to reach that view

#### Scenario: Zoom in control

- **WHEN** the wheel is turned to zoom in, rather than a dedicated zoom-in control being used
- **THEN** the view zooms in about the pointer, staying within the allowed bounds, with no
  separate zoom-in control needed

#### Scenario: Zoom out control

- **WHEN** the wheel is turned to zoom out, rather than a dedicated zoom-out control being used
- **THEN** the view zooms out about the pointer, staying within the allowed bounds, with no
  separate zoom-out control needed

### Requirement: Label detail follows the zoom

Node titles SHALL be drawn near the node. The amount of title shown SHALL depend on
the zoom: below a low threshold only the titles of hub nodes and of the selected or
hovered node are shown; at intermediate zoom titles are shown truncated; above a
high threshold titles are shown in full.

#### Scenario: Zoomed far out

- **WHEN** the view is zoomed below the low threshold
- **THEN** only hub titles and the titles of the hovered or selected node are drawn

#### Scenario: Zoomed in

- **WHEN** the view is zoomed above the high threshold
- **THEN** every visible node's title is drawn in full

### Requirement: Groups can be filtered and are drawn as clusters

Nodes SHALL be grouped by project, and by scope where a node belongs to no project. The view
SHALL show a legend naming every group with the colour used for it, and choosing a group in
the legend SHALL hide or show that group's nodes. A hidden group's nodes and the edges
touching them SHALL be excluded from the drawing and from the layout, and the remaining
graph SHALL settle again.

Each node SHALL be filled with its group's colour, so that a group is legible as a cluster of
same-coloured nodes drawn near each other, without a separate boundary shape drawn around it.

#### Scenario: Hiding a group

- **WHEN** a group is switched off in the legend
- **THEN** its nodes and the edges touching them are no longer drawn and the rest of the
  graph settles into the space

#### Scenario: A group's cluster region

- **WHEN** a group has two or more visible nodes
- **THEN** its nodes share their group's fill colour and are laid out nearer each other than
  to another group's nodes, rather than being enclosed by a separately drawn region

#### Scenario: Every group hidden

- **WHEN** every group is switched off
- **THEN** the view says there is nothing to draw rather than showing an empty frame

### Requirement: Nodes and edges carry their meaning

A node SHALL be drawn as a circle filled with its group's colour. A node's radius SHALL encode
its number of links, and a hub file SHALL be drawn so it is distinguishable from a document at
a glance.

An edge SHALL be drawn with an arrowhead at its target when the link exists in one
direction only. When two pages link to each other, the pair SHALL be drawn as a
single edge with no arrowhead. An edge's endpoint SHALL be trimmed to the target circle's
visible boundary rather than terminating at or past its centre or its label.

Two nodes' circles SHALL NOT overlap once the layout has settled. A node's label SHALL NOT be
painted so that another node's circle or label covers it. While the layout is unsettled — moving
under a fresh disturbance such as a drag or a reheat — two nodes MAY transiently sit close enough
that their labels would collide before collision has fully resolved them; for that transient case,
the one judged less important to show — the lower-degree of the pair, with ties broken by keeping
whichever is closer to the pointer or the current selection — SHALL have its label suppressed or
faded rather than be silently painted over. A hub's label SHALL never be the one suppressed by a
document sharing its position.

#### Scenario: A one-way link

- **WHEN** one page links to another and the second does not link back
- **THEN** the edge between them is drawn with an arrowhead pointing at the second page

#### Scenario: A reciprocal link

- **WHEN** two pages link to each other
- **THEN** they are joined by one edge with no arrowhead rather than two edges

#### Scenario: A hub among documents

- **WHEN** a hub file and a document are both drawn
- **THEN** they are distinguishable by size or weight, each node's radius reflects its
  number of links, and each node shows its title at the default zoom

#### Scenario: An edge trims to the rectangle, not a circumscribed circle

<!-- Name kept for spec history; the node this scenario trims edges against is itself now a
     circle, so trimming to its boundary is exact rather than an approximation of a rectangle. -->
- **WHEN** an edge arrives at a node from any angle
- **THEN** the edge terminates at that node's own visible boundary — a real circle now, not a
  circle standing in for some other shape — rather than at its centre or short of it

#### Scenario: Chips do not overlap once the layout has settled

<!-- Name kept for spec history; "chip" now means the circular node. -->
- **WHEN** the layout has settled for a graph of nodes of varied sizes
- **THEN** no two nodes' circles overlap

#### Scenario: Two chips still end up close together

- **WHEN** a node is dragged so that it transiently ends up close enough to a neighbour that
  their labels would collide, before collision has had a chance to separate them again
- **THEN** at most one of the two labels is drawn at that position, chosen by degree,
  and the other's label is suppressed or faded rather than drawn underneath the first

#### Scenario: A hub is never hidden by a document

- **WHEN** a hub node and a document node end up close enough that one label must be
  suppressed
- **THEN** the hub's label is the one that stays visible

### Requirement: Reduced motion is honoured

When the reader has asked for reduced motion, the layout SHALL be computed to convergence in
one pass and drawn once, with no continuous animation and no animated transitions of the
viewport. Every interaction SHALL still work: dragging a node SHALL move it, and releasing,
pinning, filtering or refetching SHALL settle the layout in one step rather than over time.

#### Scenario: Opening the graph with reduced motion

- **WHEN** the graph is opened and the reader prefers reduced motion
- **THEN** the settled layout is drawn immediately and no animation frames are scheduled

#### Scenario: Fitting the view with reduced motion

- **WHEN** a search brings a single matching node into the viewport — the one remaining
  reader-triggered viewport change now that there is no separate fit or reset control — and
  the reader prefers reduced motion
- **THEN** the viewport changes in one step rather than animating

### Requirement: The graph follows the app's theme

Every colour and type size the graph draws — nodes, edges, labels, highlight and dimming —
SHALL come from the app's design tokens, so that switching between the light and dark themes
restyles the graph with no other change.

#### Scenario: Switching theme

- **WHEN** the app is switched between its light and dark themes with the graph open
- **THEN** the graph's nodes, edges and labels take the new theme's colours

### Requirement: The default layout is spread out

The force layout SHALL space nodes so that at the default viewport neighbouring
nodes do not overlap and each visible title can be read without a first zoom.
Clustering by project or scope SHALL remain, but SHALL NOT pack a group's pages into a
single unreadable clump.

Siblings in the same group — nodes with no direct link between them, pulled together only by
the shared cluster — SHALL be kept apart by at least the same margin as linked nodes. A
group's clustering SHALL NOT be pulled so tightly that its own collision resolution cannot
keep up: the layout SHALL still read as separated nodes, not a blob, once the layout has
settled, regardless of how many pages the group has.

#### Scenario: Neighbours are separated

- **WHEN** the graph view is opened with several linked nodes
- **THEN** neighbouring nodes are separated by a gap and their titles do not sit on
  top of one another

#### Scenario: A crowded group stays legible

- **WHEN** a group has enough pages that they would otherwise be pulled into a single dense
  clump
- **THEN** the settled layout still keeps each node in that group separated from its
  siblings by a visible gap
