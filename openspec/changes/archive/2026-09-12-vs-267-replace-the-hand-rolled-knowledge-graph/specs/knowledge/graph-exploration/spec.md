## MODIFIED Requirements

### Requirement: The viewport can be zoomed and panned

The graph SHALL be zoomable with the mouse wheel, with a two-finger pinch, and with
zoom-in and zoom-out controls, and pannable by dragging the background with a mouse
or a finger. Zooming with a pointer SHALL keep the point under the pointer in place.
The zoom SHALL be bounded at both ends.

The canvas SHALL own wheel, pinch and drag input for zoom and pan from the moment it exists in the
page, rather than attaching a listener after first paint that competes with the page for the
gesture. A wheel gesture over the graph SHALL zoom the graph and SHALL NOT scroll the surrounding
page.

The view SHALL offer a **fit** control that frames every visible node, a **reset**
control that returns the viewport to its default zoom and position, and **zoom in**
and **zoom out** controls. Opening the graph SHALL start from a readable default
zoom, centred on the layout, at which node titles are visible — not from a fitted
overview that shrinks the whole graph into the frame.

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

### Requirement: Nodes and edges carry their meaning

A node SHALL be drawn as a labeled chip: the page title in the app's type scale,
on a surface that uses the app's background and border tokens, with the node's
group colour as an accent rather than as a filled blob. A node's size SHALL still
encode its number of links, and a hub file SHALL be drawn so it is distinguishable
from a document at a glance.

An edge SHALL be drawn with an arrowhead at its target when the link exists in one
direction only. When two pages link to each other, the pair SHALL be drawn as a
single edge with no arrowhead. An edge's endpoint SHALL be trimmed to the chip's visible
rectangle boundary — the point where the line to the other chip's centre actually crosses that
chip's edge — rather than to a circle standing in for the chip's shape. This SHALL hold
regardless of the angle the edge arrives from, including near-vertically above or below a chip,
where a circular approximation is furthest from the chip's real boundary.

Two chips' rectangles SHALL NOT overlap once the layout has settled: collision uses the same
axis-aligned rectangle test that decides whether two chips overlap for any other purpose, not a
circular approximation of the chip. A node's chip, including its label, SHALL NOT be painted so
that another node's chip covers it. While the layout is unsettled — moving under a fresh disturbance
such as a drag or a reheat — two chips MAY transiently overlap before collision resolves them; for
that transient case, the one judged less important to show — the smaller or lower-degree of the
pair, with ties broken by keeping whichever is closer to the pointer or the current selection —
SHALL have its label suppressed or faded rather than be silently painted over. A hub's label SHALL
never be the one suppressed by a document sharing its position.

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

#### Scenario: An edge trims to the rectangle, not a circumscribed circle

- **WHEN** an edge arrives at a wide, short chip from near-vertically above or below it
- **THEN** the edge terminates at that chip's visible rectangle boundary rather than stopping
  short of it at the distance a circumscribed circle would imply

#### Scenario: Chips do not overlap once the layout has settled

- **WHEN** the layout has settled for a graph of chips of varied sizes
- **THEN** no two chips' rectangles overlap, checked pairwise by the same axis-aligned box test
  the rest of the graph's overlap handling uses

#### Scenario: Two chips still end up close together

- **WHEN** a chip is dragged so that it transiently overlaps a neighbour before collision has had a
  chance to separate them again
- **THEN** at most one of the two labels is drawn at that position, chosen by size or degree,
  and the other's label is suppressed or faded rather than drawn underneath the first

#### Scenario: A hub is never hidden by a document

- **WHEN** a hub chip and a document chip end up close enough that one label must be
  suppressed
- **THEN** the hub's label is the one that stays visible
