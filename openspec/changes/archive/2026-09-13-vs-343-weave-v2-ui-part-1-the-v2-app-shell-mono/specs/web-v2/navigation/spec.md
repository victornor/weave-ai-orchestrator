## Purpose

How the V2 app moves a person between destinations: an Everywhere group above each workspace in a
collapsible rail, exactly one highlighted row that agrees with the header, a scope that travels with
navigation, and a phone tab bar with a grouped More list so every destination is reachable.

## ADDED Requirements

### Requirement: The rail groups destinations as Everywhere above each workspace

The desktop rail SHALL show an Everywhere group, holding Needs you, Live, Incidents, Map, Runs,
Scheduled and Settings, above the workspace groups. A workspace group SHALL hold Chat, Needs you,
Work, Roles and Knowledge. Every row SHALL carry an icon. The rail SHALL NOT show a Projects
heading, SHALL NOT show hotkey numbers on any row, and SHALL render project names as coloured text
rather than a coloured marker. The slot a `⌘K` hint would occupy SHALL hold the sidebar collapse
button.

#### Scenario: The Everywhere group

- **WHEN** the rail renders
- **THEN** Needs you, Live, Incidents, Map, Runs, Scheduled and Settings appear above every
  workspace group, each with an icon

#### Scenario: The workspace group

- **WHEN** the rail renders a workspace
- **THEN** it holds Chat, Needs you, Work, Roles and Knowledge, each with an icon, and names the
  workspace

#### Scenario: Work, not Board

- **WHEN** the rail names the board destination
- **THEN** it reads `Work` and not `Board`

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
The collapsed rail SHALL keep a dot on Needs you when decisions are open and SHALL show a row's
label on hover. The collapsed or expanded choice SHALL be remembered on the device and restored on
the next visit.

#### Scenario: Collapsing

- **WHEN** the user activates the collapse control
- **THEN** the rail becomes a 48px mark-only rail, still grouped as when expanded, and the workspace
  is marked by its initial

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
same source the screen body renders, never from a separate literal.

#### Scenario: The row matches the header

- **WHEN** a V2 route is shown
- **THEN** exactly one rail row is highlighted and its destination is the one the header names

#### Scenario: Drilling into a ticket

- **WHEN** a ticket page is shown
- **THEN** the workspace destination that owns it is the highlighted row and the header names that
  workspace as its root

#### Scenario: Counts agree

- **WHEN** a header shows a count of decisions or workers
- **THEN** it is the same number the same page's body derives, not a second value

### Requirement: Navigation preserves scope

A destination that names no scope SHALL inherit the scope the app is currently showing, rather than
defaulting to Everywhere. A workspace's Needs you SHALL open the global Needs you screen with that
workspace's scope pre-applied, and exactly one rail row SHALL be highlighted as a result. Live SHALL
exist only as a global destination, with scope acting as a filter rather than a separate page.

#### Scenario: A workspace screen to an unscoped destination

- **WHEN** the user moves from a workspace's Work screen to a destination that names no scope, such
  as a project
- **THEN** the destination inherits that workspace's scope and the header root still names it

#### Scenario: The workspace Needs you shortcut

- **WHEN** the user activates Needs you inside a workspace group
- **THEN** the global Needs you screen opens with that workspace's scope pre-applied and its rail row
  highlighted

#### Scenario: Live is global

- **WHEN** the user activates Live
- **THEN** the global Live screen opens and the workspace groups do not offer a separate Live page

#### Scenario: Scope does not drift

- **WHEN** the user moves between a workspace destination and its unscoped children
- **THEN** the scope stays on that workspace and no destination arrives with the wrong scope

### Requirement: The phone tab bar and More list reach every destination

At phone width the V2 app SHALL show a bottom tab bar of Chat, Needs you, Work, Live and More.
Needs you and Live SHALL open the global screens; Work SHALL stay workspace-scoped. More SHALL be a
grouped destination list, not an alias for one screen, with 48px rows carrying a mark, a count and
a chevron. Every V2 destination SHALL be reachable from the tab bar or the More list.

#### Scenario: The tab bar

- **WHEN** a phone-width V2 app renders
- **THEN** the tab bar shows Chat, Needs you, Work, Live and More

#### Scenario: Needs you and Live are global

- **WHEN** the user taps Needs you or Live in the tab bar
- **THEN** the global screen for that destination opens

#### Scenario: Work stays scoped

- **WHEN** the user taps Work in the tab bar
- **THEN** the current workspace's Work screen opens

#### Scenario: More lists every destination

- **WHEN** the user opens More
- **THEN** it shows the destinations grouped as Everywhere and by workspace, each row a mark, a
  label, its count and a chevron, and every V2 destination is reachable from it
