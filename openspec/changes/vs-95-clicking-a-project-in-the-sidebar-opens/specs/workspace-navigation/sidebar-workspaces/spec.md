## ADDED Requirements

### Requirement: A workspace group lists its projects, each opening that project's overview

The sidebar group of the workspace the app is currently showing SHALL list that workspace's
projects, below its section links, each identified by the project's slug. Activating a project SHALL
open that project's overview page.

Projects SHALL be listed for the active workspace only, since another workspace's projects are not
loaded; a workspace with no projects SHALL simply list none, without an empty block or an error.
Following a project SHALL navigate within the running application, without a document reload.

#### Scenario: Opening a project

- **WHEN** the human activates a project in the active workspace's sidebar group
- **THEN** that project's overview opens, without a document reload

#### Scenario: A workspace with no projects

- **WHEN** the active workspace has no projects
- **THEN** its group shows its section links and no project list, and no error is shown

#### Scenario: Another workspace's group

- **WHEN** a non-active workspace's group is expanded
- **THEN** it shows that workspace's section links and no project list

## MODIFIED Requirements

### Requirement: The phone keeps its tabs and offers the workspace list

On a phone viewport the bottom bar SHALL keep exactly the five tabs it has today, addressing the
active workspace, and SHALL NOT grow a workspace list.

The last of those tabs SHALL NOT navigate. It SHALL open a menu, presented over the application as a
dismissible dialog, containing:

- a link to every destination the application has that the bar's tabs do not carry, including the
  merge queue, each named and addressing the active workspace;
- the active workspace's projects, each named by its slug and opening that project's overview;
- the workspace list, with each workspace's Needs-you count, where choosing a workspace navigates to
  it and makes it active;
- the action that begins creating a new workspace;
- the daemon's release state, when there is something to say about it, opening the section that
  shows it.

A workspace with no projects SHALL contribute no project block to the menu.

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
- **THEN** every destination the five tabs do not carry is listed, including the merge queue, and
  choosing one goes to that destination of the active workspace

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
