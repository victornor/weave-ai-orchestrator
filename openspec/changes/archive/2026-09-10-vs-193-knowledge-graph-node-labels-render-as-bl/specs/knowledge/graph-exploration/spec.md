## MODIFIED Requirements

### Requirement: The default layout is spread out

The force layout SHALL space nodes so that at the default viewport neighbouring
chips do not overlap and each visible title can be read without a first zoom.
Clustering by project or scope SHALL remain, but SHALL NOT pack a group's pages into a
single unreadable clump.

Siblings in the same group — nodes with no direct link between them, pulled together only by
the shared cluster — SHALL be kept apart by at least the same margin as linked nodes. A
group's clustering SHALL NOT be pulled so tightly that its own collision resolution cannot
keep up: the layout SHALL still read as separated chips, not a blob, once the layout has
settled, regardless of how many pages the group has.

#### Scenario: Neighbours are separated

- **WHEN** the graph view is opened with several linked nodes
- **THEN** neighbouring chips are separated by a gap and their titles do not sit on
  top of one another

#### Scenario: A crowded group stays legible

- **WHEN** a group has enough pages that they would otherwise be pulled into a single dense
  clump
- **THEN** the settled layout still keeps each chip in that group separated from its
  siblings by a visible gap

### Requirement: Nodes and edges carry their meaning

A node SHALL be drawn as a labeled chip: the page title in the app's type scale,
on a surface that uses the app's background and border tokens, with the node's
group colour as an accent rather than as a filled blob. A node's size SHALL still
encode its number of links, and a hub file SHALL be drawn so it is distinguishable
from a document at a glance.

An edge SHALL be drawn with an arrowhead at its target when the link exists in one
direction only. When two pages link to each other, the pair SHALL be drawn as a
single edge with no arrowhead.

A node's chip, including its label, SHALL NOT be painted so that another node's chip covers
it. When the layout cannot keep two chips fully apart, the one judged less important to show
— the smaller or lower-degree of the pair, with ties broken by keeping whichever is closer to
the pointer or the current selection — SHALL have its label suppressed or faded rather than
be silently painted over. A hub's label SHALL never be the one suppressed by a document
sharing its position.

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

#### Scenario: Two chips still end up close together

- **WHEN** the settled layout leaves two chips overlapping or nearly touching
- **THEN** at most one of the two labels is drawn at that position, chosen by size or degree,
  and the other's label is suppressed or faded rather than drawn underneath the first

#### Scenario: A hub is never hidden by a document

- **WHEN** a hub chip and a document chip end up close enough that one label must be
  suppressed
- **THEN** the hub's label is the one that stays visible

## ADDED Requirements

### Requirement: The canvas is measured against its own rendered frame

Before the graph is first drawn, and whenever the canvas element becomes visible after being
hidden, its size SHALL be read from the frame that is actually on screen — not from a
fallback used because the frame had not yet been measured. The viewport fit computed at open
SHALL match the space the reader can actually see, with no dimension assumed from a screen
size the reader is not using.

#### Scenario: Opening on a phone list, then switching to canvas

- **WHEN** the graph opens to the phone neighbour list and the reader switches to the canvas
- **THEN** the canvas is measured against its own on-screen size before the layout is fit to
  it, not against a size assumed while the canvas was hidden

#### Scenario: The canvas is never assumed to be desktop-sized

- **WHEN** the graph opens directly to the canvas at a narrow viewport
- **THEN** the default view fits the layout to the narrow viewport's actual measured size

### Requirement: The graph's structure reads at workspace scale without panning

At the scale the workspace's knowledge base reaches in ordinary use — tens of pages and
several dozen links — the settled layout SHALL be readable at the default zoom without
panning or zooming: a group's pages SHALL sit visibly nearer each other than to another
group's pages, and edge crossings SHALL be kept low enough that the graph reads as connected
structure rather than as an undifferentiated tangle.

#### Scenario: A workspace-scale graph reads without panning

- **WHEN** the graph has on the order of thirty pages and several dozen links across a
  handful of groups
- **THEN** the settled layout at the default zoom shows each group as a visibly separate
  cluster, with edges that can be followed rather than crossing indiscriminately, and nothing
  the reader needs is only reachable by panning
