## MODIFIED Requirements

### Requirement: The phone keeps its tabs and offers the workspace list

On a phone viewport the bottom bar SHALL keep exactly the five tabs it has today, addressing the
active workspace when a workspace page is showing, and SHALL NOT grow a workspace list.

The last of those tabs SHALL NOT navigate. It SHALL open a menu, presented over the application as a
dismissible dialog, containing:

- Global Needs you, Global Live, Global Chats, Global Incidents, Global Map, Global Scheduled and
  Global Settings, each named, addressing the daemon-wide pages rather than a workspace, listed
  above the per-workspace leftovers;
- a link to every destination the application has that the bar's tabs do not carry, including the
  merge queue and Live, each named and addressing the active workspace;
- the active workspace's projects, each named by the project's display label and opening that project's overview, and
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

#### Scenario: Reaching global Incidents from More

- **WHEN** the human opens More on a phone and chooses Global Incidents
- **THEN** the app shows the global Incidents page and the menu is dismissed

#### Scenario: Reaching global Map from More

- **WHEN** the human opens More on a phone and chooses Global Map
- **THEN** the app shows the global Map page and the menu is dismissed

#### Scenario: Reaching global Scheduled from More

- **WHEN** the human opens More on a phone and chooses Global Scheduled
- **THEN** the app shows the global Scheduled page and the menu is dismissed

### Requirement: A workspace group lists its projects, each opening that project's overview

Every expanded sidebar group — the active workspace's, which is always expanded, and any other
workspace's group the human has expanded — SHALL list that workspace's **active** (non-archived)
projects, below its section links, each named by the project's display label — its name,
falling back to its slug. An archived project SHALL
NOT appear as a row in the group. Activating a project SHALL open that project's overview page;
when the project belongs to a workspace other than the one currently being shown, activating it
SHALL also make that project's workspace the active one, as part of the same navigation, so the
rail and the content never disagree about which workspace is showing. Following a project SHALL
navigate within the running application, without a document reload.

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
- **THEN** it shows that workspace's section links and that workspace's own projects, named by the
  project's display label

#### Scenario: Expanding a non-active workspace lists its projects

- **WHEN** the human expands a workspace group that has never been expanded before, and that
  workspace has projects
- **THEN** its projects are fetched and then listed, each named by the project's display label

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

#### Scenario: An archived project is not listed

- **WHEN** a workspace's fetched projects include one whose status is archived
- **THEN** that project is not shown as a row in the group, and the New project action remains

### Requirement: A project's sidebar entry marks a diverged clone, and quietly marks a behind one

Each project listed in a sidebar group SHALL carry a marker reflecting that project's sync state
(`project-overview/sync-status`), read from data the sidebar already has rather than a check made
for the marker itself. A project that is `in_sync` SHALL show no sync marker. A project that is
`diverged` SHALL show a marker using the same visual severity the sidebar already uses for a
project or ticket that needs a human. A project that is `behind` SHALL show a marker,
distinguishable from the diverged marker, using materially less visual severity — the same weight
already used for an ordinary in-progress state — so that an entirely routine merge does not read as
an alert.

Independently of its sync state, each project's entry SHALL show that project's display label in
that project's own colour (`workspace-navigation/project-colour`). It SHALL NOT show a separate
project-colour circle. The sync marker, when present, SHALL remain a status marker alongside the
coloured label, never replaced by it. Both SHALL be visible at once when the project is not
`in_sync`.

#### Scenario: A project that is in sync

- **WHEN** a sidebar group lists a project whose clone is `in_sync`
- **THEN** that project's entry shows no sync marker, and shows that project's display label
  in that project's own colour, with no project-colour circle

#### Scenario: A project that has diverged

- **WHEN** a sidebar group lists a project whose clone has `diverged`
- **THEN** that project's entry shows a marker with the same severity the sidebar uses elsewhere for
  something that needs a human, and shows that project's display label in that project's own colour, with no
  project-colour circle

#### Scenario: A project that is behind

- **WHEN** a sidebar group lists a project whose clone is `behind`
- **THEN** that project's entry shows a marker distinguishable from the diverged marker and with
  materially less visual severity, and shows that project's display label in that project's own colour,
  with no project-colour circle

#### Scenario: The marker costs no extra request

- **WHEN** the sidebar renders a group's projects
- **THEN** no request beyond the project list already being fetched is made to determine any of
  their sync markers or their colours

#### Scenario: Two projects in the same group are told apart by colour

- **WHEN** a sidebar group lists two or more projects
- **THEN** each is shown with its project's display label in its own project's colour, distinguishable from the other
  projects listed in that group
