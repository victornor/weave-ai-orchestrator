## ADDED Requirements

### Requirement: An expanded workspace group offers a New project action

Every expanded sidebar group SHALL offer an action labelled "New project" under that group's
project rows, using the same plus mark the sidebar already uses for creating a workspace. The
action SHALL be a named link or button, not an icon-only control.

Activating it SHALL navigate, without a document reload, to that group's workspace's Settings at
the Projects section — the existing add-project form, addressed by the Settings URL's section key.
The sidebar SHALL NOT present a git-URL form or any other add-project UI of its own.

The action SHALL be shown whenever the group is expanded: while that group's projects are loading,
when the fetch failed, when the workspace has projects, and when it has none. A collapsed group
SHALL NOT show it.

On a phone viewport, where the sidebar is not shown, the same action SHALL be reachable in the menu
the More tab opens, in the place that menu already shows that workspace's projects, and SHALL
dismiss the menu on activate.

#### Scenario: Adding a project from an open group that has projects

- **WHEN** the human activates New project under the active workspace's listed projects
- **THEN** the app shows that workspace's Settings at the Projects section, without a document
  reload, and no add-project form is shown in the sidebar

#### Scenario: An empty workspace still offers New project

- **WHEN** a workspace's group is expanded (or, for the active workspace, shown) and that workspace
  has no projects
- **THEN** New project is shown under where the project rows would be, and no error is shown

#### Scenario: Loading and a failed fetch still offer New project

- **WHEN** a workspace's group is expanded and its project fetch is still outstanding, or has failed
- **THEN** New project is shown in that group along with the loading or error state

#### Scenario: A collapsed group has no New project

- **WHEN** a non-active workspace's group is collapsed
- **THEN** New project is not shown for that workspace

#### Scenario: New project in another workspace switches to it

- **WHEN** the human activates New project in a non-active workspace's expanded group
- **THEN** the app shows that workspace's Settings at the Projects section and that workspace
  becomes the active one

#### Scenario: Adding a project on a phone

- **WHEN** the human opens More on a phone and activates New project
- **THEN** the app shows the active workspace's Settings at the Projects section and the menu is
  dismissed

#### Scenario: An empty workspace still offers New project on a phone

- **WHEN** the human opens More on a phone and the active workspace has no projects
- **THEN** New project is shown where that workspace's projects would be listed

## MODIFIED Requirements

### Requirement: A workspace group lists its projects, each opening that project's overview

Every expanded sidebar group — the active workspace's, which is always expanded, and any other
workspace's group the human has expanded — SHALL list that workspace's projects, below its section
links, each identified by the project's slug. Activating a project SHALL open that project's
overview page; when the project belongs to a workspace other than the one currently being shown,
activating it SHALL also make that project's workspace the active one, as part of the same
navigation, so the rail and the content never disagree about which workspace is showing. Following a
project SHALL navigate within the running application, without a document reload.

A workspace's projects SHALL be fetched the first time its group is expanded, and kept from then on:
collapsing and re-expanding the same group SHALL NOT fetch again. A workspace whose group has never
been expanded SHALL NOT have its projects fetched. The active workspace's projects SHALL be fetched
regardless of whether its group has been explicitly expanded, since that group is always open.

While a group's projects are being fetched for the first time, that group SHALL show a loading state
distinguishable from having no projects — a group SHALL NOT render as though a workspace has no
projects while its fetch is still outstanding. A workspace that genuinely has no projects SHALL show
its section links and no project rows, without an empty-list error; the New project action SHALL
still be shown. When a workspace's project fetch fails, that group alone SHALL show that it could
not load its projects; every other group, expanded or collapsed, SHALL be unaffected and SHALL keep
working.

#### Scenario: Opening a project

- **WHEN** the human activates a project in the active workspace's sidebar group
- **THEN** that project's overview opens, without a document reload

#### Scenario: Opening a project in a non-active workspace

- **WHEN** the human expands a non-active workspace's group, its projects have loaded, and the human
  activates one of them
- **THEN** that project's overview opens, that workspace becomes the active one, and the rail and the
  content agree on which workspace is showing

#### Scenario: Another workspace's group

- **WHEN** a non-active workspace's group is expanded and its projects have loaded
- **THEN** it shows that workspace's section links and that workspace's own projects, each identified
  by its slug

#### Scenario: Expanding a non-active workspace lists its projects

- **WHEN** the human expands a workspace group that has never been expanded before, and that
  workspace has projects
- **THEN** its projects are fetched and then listed, each identified by its slug

#### Scenario: A workspace with no projects

- **WHEN** a workspace's group is expanded (or, for the active workspace, shown) and that fetch
  completes with no projects
- **THEN** its group shows its section links and no project rows, the New project action is shown,
  and no error is shown

#### Scenario: Loading is not mistaken for empty

- **WHEN** a workspace's group is expanded and its project fetch has not yet completed
- **THEN** the group shows a loading state, not an empty project list and not the workspace's
  projects from before the fetch started

#### Scenario: A failed fetch is scoped to its own group

- **WHEN** one workspace's project fetch fails while another workspace's group is also expanded
- **THEN** the failed workspace's group shows that its projects could not load, and the other
  expanded group still lists its own projects normally

#### Scenario: Collapsing and re-expanding does not refetch

- **WHEN** the human collapses a non-active workspace's group whose projects already loaded, then
  expands it again
- **THEN** its projects are shown immediately from what was already fetched, with no new request

#### Scenario: A workspace never expanded costs nothing

- **WHEN** the sidebar renders with several workspaces listed and only some of their groups ever
  expanded
- **THEN** projects are never fetched for a workspace whose group has not been expanded and is not
  the active workspace

### Requirement: The phone keeps its tabs and offers the workspace list

On a phone viewport the bottom bar SHALL keep exactly the five tabs it has today, addressing the
active workspace, and SHALL NOT grow a workspace list.

The last of those tabs SHALL NOT navigate. It SHALL open a menu, presented over the application as a
dismissible dialog, containing:

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
