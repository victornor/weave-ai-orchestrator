## MODIFIED Requirements

### Requirement: The active section and active workspace are visible

When the app is showing a workspace page, the sidebar SHALL mark that workspace group as the active
one, and within it SHALL mark the section link matching the current location. Exactly one workspace
SHALL be marked active at a time, and a section link in a non-active workspace's group SHALL NOT be
marked active even when its section matches the current one.

When the app is showing a global Needs you, Live, Chats or Map page, no workspace group SHALL be
marked active, and the matching link in the global section SHALL be marked as the current one.

#### Scenario: Showing a board

- **WHEN** the app is showing workspace A's board and workspace B's group is also expanded
- **THEN** A's group is marked active and its Board link is marked as the current one, and B's Board
  link is not marked

#### Scenario: Showing global Needs you

- **WHEN** the app is showing the global Needs you page
- **THEN** no workspace group is marked active, and the global section's Needs you link is marked as
  the current one

#### Scenario: Showing global Live

- **WHEN** the app is showing the global Live page
- **THEN** no workspace group is marked active, and the global section's Live link is marked as the
  current one

#### Scenario: Showing global Chats

- **WHEN** the app is showing the global Chats page
- **THEN** no workspace group is marked active, and the global section's Chats link is marked as the
  current one

#### Scenario: Showing global Map

- **WHEN** the app is showing the global Map page
- **THEN** no workspace group is marked active, and the global section's Map link is marked as the
  current one

### Requirement: The phone keeps its tabs and offers the workspace list

On a phone viewport the bottom bar SHALL keep exactly the five tabs it has today, addressing the
active workspace when a workspace page is showing, and SHALL NOT grow a workspace list.

The last of those tabs SHALL NOT navigate. It SHALL open a menu, presented over the application as a
dismissible dialog, containing:

- Global Needs you, Global Live, Global Chats and Global Map, each named, addressing the daemon-wide
  pages rather than a workspace, listed above the per-workspace leftovers;
- a link to every destination the application has that the bar's tabs do not carry, including the
  merge queue and Live, each named and addressing the active workspace;
- the active workspace's projects, each named by its slug and opening that project's overview, and
  the action that begins adding a project;
- the workspace list, with each workspace's Needs-you count, where choosing a workspace navigates to
  it and makes it active;
- the action that begins creating a new workspace;
- the daemon's release state, when there is something to say about it, opening the section that
  shows it.

A workspace with no projects SHALL still contribute the New project action to the menu, and SHALL
contribute no project rows.

The menu SHALL be dismissed by choosing any of its items, by a tap outside it, by Escape, and by
dragging it downwards past a threshold. While it is open, keyboard focus SHALL stay within it, and
every item SHALL be a link or a button with an accessible name.

Opening the menu SHALL NOT change the bottom bar's geometry, which SHALL keep laying out within a
390 px viewport without overlapping the content above it.

The tab SHALL be marked active whenever the page being shown is one of the menu's destinations, and
SHALL carry at most one badge: the daemon's release state when there is something to say about it,
and otherwise the Needs-you count of the workspaces other than the active one, which the tabs cannot
show.

The workspace list SHALL also remain at the top of Settings, so that arriving at Settings by any
other route still reaches the other workspaces.

#### Scenario: Reaching another workspace on a phone

- **WHEN** the human opens More and chooses another workspace from the list
- **THEN** the app shows that workspace and makes it active

#### Scenario: Reaching a destination the bar has no tab for

- **WHEN** the human opens More on a phone
- **THEN** every destination the five tabs do not carry is listed, including the merge queue and
  Live, and choosing one goes to that destination of the active workspace

#### Scenario: Reaching a project on a phone

- **WHEN** the human opens More on a phone and chooses a project
- **THEN** that project's overview opens and the menu is dismissed

#### Scenario: The tab bar is unchanged

- **WHEN** the bottom bar is rendered with several workspaces loaded
- **THEN** it still shows five tabs, all addressing the active workspace, and the last one opens the
  menu rather than navigating

#### Scenario: Dismissing the menu

- **WHEN** the human taps outside the open menu, presses Escape, or drags it down past the threshold
- **THEN** the menu closes and the page underneath is unchanged

#### Scenario: Where you are, from the bar

- **WHEN** the app is showing one of the menu's destinations
- **THEN** the tab that opens the menu is marked active

#### Scenario: Another workspace is waiting

- **WHEN** a workspace other than the active one has something waiting for the human and the daemon
  has nothing to say about its release
- **THEN** the tab that opens the menu carries that count

#### Scenario: Settings is still not a dead end

- **WHEN** Settings is opened on a phone
- **THEN** the workspace list is still the first block of the page

#### Scenario: Reaching global Needs you from More

- **WHEN** the human opens More on a phone and chooses Global Needs you
- **THEN** the app shows the global Needs you page and the menu is dismissed

#### Scenario: Reaching global Live from More

- **WHEN** the human opens More on a phone and chooses Global Live
- **THEN** the app shows the global Live page and the menu is dismissed

#### Scenario: Reaching global Chats from More

- **WHEN** the human opens More on a phone and chooses Global Chats
- **THEN** the app shows the global Chats page and the menu is dismissed

#### Scenario: Reaching global Map from More

- **WHEN** the human opens More on a phone and chooses Global Map
- **THEN** the app shows the global Map page and the menu is dismissed

### Requirement: A global section sits above the workspace list

On a desktop viewport the sidebar SHALL show a global section above the workspace list, containing
a link named Needs you, a link named Live, a link named Chats and a link named Map, in that order.
Those links SHALL address the daemon-wide pages, not a workspace. The section SHALL be present
whether or not a workspace is currently being shown, and whether or not the workspace list has
loaded.

The global section SHALL NOT replace any workspace group's own Needs you, Live or Chat links.

#### Scenario: The global section is above the workspaces

- **WHEN** the sidebar is shown on a desktop viewport
- **THEN** Needs you, Live, Chats and Map links appear above the workspace list

#### Scenario: Needs you in the global section opens global Needs you

- **WHEN** the human activates Needs you in the sidebar's global section
- **THEN** the app shows the global Needs you page without a document reload

#### Scenario: Live in the global section opens global Live

- **WHEN** the human activates Live in the sidebar's global section
- **THEN** the app shows the global Live page without a document reload

#### Scenario: Chats in the global section opens global Chats

- **WHEN** the human activates Chats in the sidebar's global section
- **THEN** the app shows the global Chats page without a document reload

#### Scenario: Map in the global section opens global Map

- **WHEN** the human activates Map in the sidebar's global section
- **THEN** the app shows the global Map page without a document reload

#### Scenario: The section is there before workspaces load

- **WHEN** the sidebar renders before the workspace list has loaded
- **THEN** the global Needs you, Live, Chats and Map links are already shown

### Requirement: Opening a global page does not switch workspace context

Following a global Needs you, Live, Chats or Map link SHALL navigate within the running application
without a document reload, SHALL NOT mark any workspace group as the active one, and SHALL NOT
change the workspace remembered for the next time the app is started.

When no workspace page is being shown, the keyboard shortcuts for the sections SHALL navigate to
that section of the workspace remembered for the next launch, if one is remembered; if none is
remembered they SHALL do nothing.

#### Scenario: Jumping to global Live from a workspace board

- **WHEN** the human is viewing workspace A's board and activates Live in the global section
- **THEN** the app shows the global Live page, A's group is no longer marked active, and the
  workspace remembered for the next launch is still A

#### Scenario: Reopening the app afterwards

- **WHEN** the app is started again on the same device after that jump
- **THEN** it opens on workspace A, not on the global Live page

#### Scenario: A shortcut still hits the remembered workspace

- **WHEN** the human is on the global Live page, workspace A is the remembered workspace, and the
  human presses the Board shortcut
- **THEN** the app goes to A's board
