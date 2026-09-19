# web-v2/navigation Specification

## Purpose
How the V2 app moves a person between destinations: an Everywhere group above each workspace in a
collapsible rail, exactly one highlighted row that agrees with the header, a scope that travels with
navigation, and a phone tab bar with a grouped More list so every destination is reachable.

## Requirements

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

### Requirement: A retired address redirects to the destination that replaced it

The app SHALL resolve an address from a previous URL scheme to the destination that replaced it,
rather than to a not-found page, keeping the address's query values. The retired addresses and their
destinations SHALL be:

| Retired address | Destination |
|---|---|
| `/v2/*` | the same path without the `/v2` prefix |
| `/w/$ws/board` | `/w/$ws/work` |
| `/w/$ws/merge-queue?project=X` | `/w/$ws/work?project=X` |
| `/w/$ws/team` | `/w/$ws/roles` |
| `/w/$ws/live` | `/live?ws=$ws` |
| `/w/$ws/runs` | `/runs?ws=$ws` |
| `/w/$ws/runs/$runId` | `/runs/$runId` |
| `/w/$ws/settings` | `/settings?scope=$ws` |

An address whose shape already matches its destination SHALL load directly rather than redirect.
`/` SHALL resolve as the app root does (the remembered workspace's Needs you, else onboarding or
sign-in). The redirect SHALL apply both to an address typed into the address bar and to a hard
reload, and SHALL NOT be served as a page of its own.

#### Scenario: An interim prefixed address

- **WHEN** `/v2/w/acme/work` is opened
- **THEN** the app lands on `/w/acme/work`

#### Scenario: A prefixed address with a query

- **WHEN** `/v2/runs?ws=acme` is opened
- **THEN** the app lands on `/runs?ws=acme`

#### Scenario: Board to Work

- **WHEN** `/w/acme/board` is opened
- **THEN** the app lands on `/w/acme/work`

#### Scenario: Merge queue to Work, keeping the project

- **WHEN** `/w/acme/merge-queue?project=proj1` is opened
- **THEN** the app lands on `/w/acme/work?project=proj1`

#### Scenario: Team to Roles

- **WHEN** `/w/acme/team` is opened
- **THEN** the app lands on `/w/acme/roles` with Acme's Roles page shown

#### Scenario: A workspace's Live to the global Live, scoped

- **WHEN** `/w/acme/live` is opened
- **THEN** the app lands on `/live?ws=acme` with Acme's scope applied

#### Scenario: A workspace's Runs to the global Runs, scoped

- **WHEN** `/w/acme/runs` is opened
- **THEN** the app lands on `/runs?ws=acme`

#### Scenario: A run detail drops the workspace segment

- **WHEN** `/w/acme/runs/run_1` is opened
- **THEN** the app lands on `/runs/run_1`

#### Scenario: A workspace's settings to the global settings, scoped

- **WHEN** `/w/acme/settings` is opened
- **THEN** the app lands on `/settings?scope=acme`

#### Scenario: A shape that already matches loads directly

- **WHEN** `/w/acme/tickets/VS-1` is opened
- **THEN** the ticket page renders without a redirect through another address

#### Scenario: A hard reload

- **WHEN** a retired address is opened directly (a fresh document load, not an in-app navigation)
- **THEN** the app lands on the destination address

### Requirement: Each project carries a Roadmap sub-link in the rail and the phone list

Under each project in the desktop rail, the app SHALL show a secondary, indented **Roadmap** child
row linking to that project's roadmap page, visually subordinate to the project row and using V2's
existing row styling. The phone More list, which lists no projects today, SHALL list each project of
the current workspace with the same Roadmap child row. Activating the project's roadmap SHALL
highlight that project's row, exactly as visiting the project overview does. A project's roadmap row
SHALL be reachable by keyboard like every other navigation row.

#### Scenario: The rail's project rows

- **WHEN** the rail renders a workspace's projects
- **THEN** each project row is followed by an indented Roadmap child row linking to that project's
  roadmap page

#### Scenario: The phone More list

- **WHEN** a phone-width app opens More
- **THEN** the current workspace's projects are listed, each with its Roadmap child row

#### Scenario: The project row highlights on its roadmap

- **WHEN** a project's roadmap page is shown
- **THEN** that project's row is the highlighted rail row

#### Scenario: The child row is keyboard reachable

- **WHEN** the rail or the More list is navigated by keyboard
- **THEN** the project's Roadmap row can be reached and activated

### Requirement: The phone More list switches workspace

At phone width the V2 app SHALL offer a way to change the workspace from the shell's own navigation,
reachable in at most two taps from any screen: opening **More**, then choosing a workspace. The phone
More list SHALL carry a **Workspaces** group listing every workspace the daemon reports, each row
carrying the workspace's name and its open Needs-you count, and SHALL mark the workspace currently
shown. Activating a row SHALL switch the app to that workspace, landing on that workspace's Needs you
screen. The group SHALL appear on a global (Everywhere) page as well as a workspace page, so a
workspace can be reached from either.

#### Scenario: Two taps switch the workspace

- **WHEN** a phone-width app is on any screen and the user opens More and activates another workspace's row
- **THEN** the app shows that workspace's Needs you screen and the shell's workspace scope is that workspace

#### Scenario: The group lists every workspace

- **WHEN** the user opens More at phone width
- **THEN** every workspace the daemon reports appears in a Workspaces group, each row carrying its name and its open Needs-you count

#### Scenario: The current workspace is marked

- **WHEN** the More list's Workspaces group renders
- **THEN** the workspace the app is currently showing is distinguished from the others

#### Scenario: Reachable from a global page

- **WHEN** the user opens More from a global (Everywhere) page
- **THEN** the Workspaces group still lists every workspace and a row still switches to it

### Requirement: Each project's rail and More-list entry lists its roles' persistent chats

Below the project's **Roadmap** child row, the V2 shell SHALL list each role hired for that project as a secondary child row in the same style, in the desktop rail and in the phone **More** list. Activating an active role's row SHALL open that role's persistent session through the same open-or-resume operation the Roles screen and the project overview use — resuming the existing conversation, or starting one on first use — and SHALL land directly on that conversation, not on the Roles screen or the project overview. A project with no hired roles SHALL add no role row.

A role that cannot serve a session (its status is not `active`) SHALL still be listed, as a disabled, non-interactive row carrying the reason it cannot chat; it SHALL NOT be presented as an actionable control. The role whose session is the page currently shown SHALL be marked as the current row. A project with more roles than the shell lists SHALL show a final row stating how many roles are not shown, opening that project's overview.

#### Scenario: A project's roles sit under its Roadmap row

- **WHEN** the rail or the phone More list renders a project with hired roles
- **THEN** each role is a secondary child row below that project's Roadmap row, and a project with no roles adds no role row

#### Scenario: A role row opens the persistent conversation

- **WHEN** the user activates an active role's row
- **THEN** that role's persistent session opens, or starts on first use, and its conversation is shown without passing through the Roles screen or the project overview

#### Scenario: A role that cannot chat is shown disabled with its reason

- **WHEN** a listed role is paused, retired or awaiting hire approval
- **THEN** its row is not actionable and carries the reason it cannot chat

#### Scenario: The open conversation is marked

- **WHEN** the page shown is a role's persistent session
- **THEN** that role's row is marked as the current row

#### Scenario: Many roles are capped

- **WHEN** a project has more roles than the shell lists
- **THEN** the listed roles are followed by one row naming how many roles are not shown, opening that project's overview

#### Scenario: The phone More list carries the same rows

- **WHEN** a phone-width app opens More
- **THEN** each listed project carries the same role rows, opening the same persistent sessions
