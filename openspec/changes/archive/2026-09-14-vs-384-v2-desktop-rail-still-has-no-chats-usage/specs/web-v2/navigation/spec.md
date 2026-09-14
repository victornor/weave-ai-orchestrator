# web-v2/navigation — delta

## MODIFIED Requirements

### Requirement: The rail groups destinations as Everywhere above each workspace

The desktop rail SHALL show an Everywhere group, holding Needs you, Live, Chats, Incidents, Map,
Runs, Scheduled and Settings, above the workspace groups. A workspace group SHALL hold Chat, Needs
you, Work, Roles, Knowledge, Usage and Changelog. Chats SHALL sit after Live in the Everywhere
group; Usage and Changelog SHALL sit after a workspace's own sections, and the knowledge graph and
knowledge explorer SHALL NOT appear in the rail. Every row SHALL carry an icon. The rail SHALL NOT
show a Projects heading, SHALL NOT show hotkey numbers on any row, and SHALL render project names as
coloured text rather than a coloured marker. The slot a `⌘K` hint would occupy SHALL hold the
sidebar collapse button.

#### Scenario: The Everywhere group

- **WHEN** the rail renders
- **THEN** Needs you, Live, Chats, Incidents, Map, Runs, Scheduled and Settings appear above every
  workspace group, each with an icon

#### Scenario: The workspace group

- **WHEN** the rail renders a workspace
- **THEN** it holds Chat, Needs you, Work, Roles, Knowledge, Usage and Changelog, each with an icon,
  and names the workspace

#### Scenario: Work, not Board

- **WHEN** the rail names the board destination
- **THEN** it reads `Work` and not `Board`

#### Scenario: The kept screens each have one rail row

- **WHEN** the rail renders at desktop width
- **THEN** Chats is a row in the Everywhere group and Usage and Changelog are rows under every
  workspace group

#### Scenario: No Projects heading and no hotkey numbers

- **WHEN** the rail lists projects and destinations
- **THEN** there is no `Projects` heading, no hotkey number appears on any row, and project names
  are coloured text

#### Scenario: The collapse button takes the `⌘K` slot

- **WHEN** the rail renders its header
- **THEN** the sidebar collapse control occupies the slot a `⌘K` hint would have used

### Requirement: The rail collapses and remembers its state

The rail SHALL collapse to a 48px rail showing marks only, grouped exactly as when expanded: the
global marks, a hairline rule and a small monospace workspace initial, then that workspace's marks.
A collapsed mark SHALL carry the same destination as its expanded row, including Chats in the global
group and Usage and Changelog in the workspace group. The collapsed rail SHALL keep a dot on Needs
you when decisions are open and SHALL show a row's label on hover. The collapsed or expanded choice
SHALL be remembered on the device and restored on the next visit.

#### Scenario: Collapsing

- **WHEN** the user activates the collapse control
- **THEN** the rail becomes a 48px mark-only rail, still grouped as when expanded, and the workspace
  is marked by its initial

#### Scenario: The kept screens keep their marks

- **WHEN** the rail is collapsed at desktop width
- **THEN** the Chats mark appears in the global group and the Usage and Changelog marks appear under
  the workspace group, each labelled on hover

#### Scenario: A waiting Needs you keeps its dot

- **WHEN** the rail is collapsed and there are open decisions for the human
- **THEN** the Needs you mark carries a dot

#### Scenario: Labels on hover

- **WHEN** the user hovers a mark in the collapsed rail
- **THEN** that destination's label is shown

#### Scenario: The choice survives a reload

- **WHEN** the user collapses or expands the rail and reloads the app
- **THEN** the rail restores the remembered state

### Requirement: Exactly one rail row highlights, and it is the header's fact

For every V2 route exactly one rail row SHALL be highlighted, and that row SHALL be the destination
the header names. The highlighted row, the header label and the header count SHALL derive from the
same fact and the same data, so they cannot disagree. A count shown in a header SHALL come from the
same source the screen body renders, never from a separate literal. A workspace's kept Usage and
Changelog rows SHALL keep that workspace's scope, and their rail row SHALL be the one highlighted
while their route is shown.

#### Scenario: The row matches the header

- **WHEN** a V2 route is shown
- **THEN** exactly one rail row is highlighted and its destination is the one the header names

#### Scenario: Drilling into a ticket

- **WHEN** a ticket page is shown
- **THEN** the workspace destination that owns it is the highlighted row and the header names that
  workspace as its root

#### Scenario: A kept screen highlights its own row

- **WHEN** Global Chats, a workspace's Usage or a workspace's Changelog is shown
- **THEN** exactly one rail row is highlighted and it is that destination's row

#### Scenario: Counts agree

- **WHEN** a header shows a count of decisions or workers
- **THEN** it is the same number the same page's body derives, not a second value
