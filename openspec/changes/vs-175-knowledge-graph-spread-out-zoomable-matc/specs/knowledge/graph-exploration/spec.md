## ADDED Requirements

### Requirement: The default layout is spread out

The force layout SHALL space nodes so that at the default viewport neighbouring
chips do not overlap and each visible title can be read without a first zoom.
Clustering by project SHALL remain, but SHALL NOT pack a group's pages into a
single unreadable clump.

#### Scenario: Neighbours are separated

- **WHEN** the graph view is opened with several linked nodes
- **THEN** neighbouring chips are separated by a gap and their titles do not sit on
  top of one another

## MODIFIED Requirements

### Requirement: The viewport can be zoomed and panned

The graph SHALL be zoomable with the mouse wheel, with a two-finger pinch, and with
zoom-in and zoom-out controls, and pannable by dragging the background with a mouse
or a finger. Zooming with a pointer SHALL keep the point under the pointer in place.
The zoom SHALL be bounded at both ends.

The view SHALL offer a **fit** control that frames every visible node, a **reset**
control that returns the viewport to its default zoom and position, and **zoom in**
and **zoom out** controls. Opening the graph SHALL start from a readable default
zoom, centred on the layout, at which node titles are visible — not from a fitted
overview that shrinks the whole graph into the frame.

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

#### Scenario: Opening at a readable zoom

- **WHEN** the graph view is opened with nodes
- **THEN** the viewport is at a zoom where node titles are visible, not fitted so
  tightly that nodes read as unmarked blobs

#### Scenario: Zoom in control

- **WHEN** the zoom-in control is used
- **THEN** the view zooms in about the centre of the viewport, staying within the allowed bounds

#### Scenario: Zoom out control

- **WHEN** the zoom-out control is used
- **THEN** the view zooms out about the centre of the viewport, staying within the allowed bounds

### Requirement: Label detail follows the zoom

Node titles SHALL be drawn on the chip. The amount of title shown SHALL depend on
the zoom: below a low threshold only the titles of hub nodes and of the selected or
hovered node are shown; at intermediate zoom titles are shown truncated; above a
high threshold titles are shown in full.

#### Scenario: Zoomed far out

- **WHEN** the view is zoomed below the low threshold
- **THEN** only hub titles and the titles of the hovered or selected node are drawn

#### Scenario: Zoomed in

- **WHEN** the view is zoomed above the high threshold
- **THEN** every visible node's title is drawn in full

### Requirement: Nodes and edges carry their meaning

A node SHALL be drawn as a labeled chip: the page title in the app's type scale,
on a surface that uses the app's background and border tokens, with the node's
group colour as an accent rather than as a filled blob. A node's size SHALL still
encode its number of links, and a hub file SHALL be drawn so it is distinguishable
from a document at a glance.

An edge SHALL be drawn with an arrowhead at its target when the link exists in one
direction only. When two pages link to each other, the pair SHALL be drawn as a
single edge with no arrowhead.

#### Scenario: A one-way link

- **WHEN** one page links to another and the second does not link back
- **THEN** the edge between them is drawn with an arrowhead pointing at the second page

#### Scenario: A reciprocal link

- **WHEN** two pages link to each other
- **THEN** they are joined by one edge with no arrowhead rather than two edges

#### Scenario: A hub among documents

- **WHEN** a hub file and a document are both drawn
- **THEN** they are distinguishable by the weight of the chip, each node's size
  reflects its number of links, and each chip shows its title at the default zoom

### Requirement: The graph follows the app's theme

Every colour, type size and chrome the graph draws — nodes, edges, labels, cluster
regions, highlight, dimming, zoom controls — SHALL come from the app's design
tokens, so that switching between the light and dark themes restyles the graph with
no other change. Nodes SHALL use the same surface, border and type language as the
rest of the web app, not a one-off filled-blob look.

#### Scenario: Switching theme

- **WHEN** the app is switched between its light and dark themes with the graph open
- **THEN** the graph's nodes, edges, labels and cluster regions take the new theme's colours
