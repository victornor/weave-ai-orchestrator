# workspace-navigation/sidebar-workspaces Specification

## Purpose
Describes how the web app's sidebar presents every workspace at once — each workspace expandable
into its own sections, its expansion remembered per device — so a human working across several
workspaces reaches any workspace's section in one click, and describes what that navigation does to
the app's workspace context and what the phone shows instead.

## Requirements

### Requirement: The sidebar lists every workspace

On a desktop viewport the sidebar SHALL list every workspace the daemon reports, one group per
workspace, identified by the workspace's name. The group SHALL be present whether or not it is the
workspace the app is currently showing.

The sidebar SHALL NOT present a workspace switcher that hides the other workspaces behind a menu.

#### Scenario: Several workspaces are loaded

- **WHEN** the daemon reports three workspaces and the sidebar is shown
- **THEN** the sidebar has a group for each of the three, each named after its workspace

#### Scenario: A single workspace

- **WHEN** the daemon reports one workspace
- **THEN** the sidebar has that one group, and no switcher control is shown

#### Scenario: The workspace list has not answered yet

- **WHEN** the sidebar renders before the workspace list has loaded
- **THEN** the sidebar shows the active workspace's group from the route alone, and adds the others
  when the list arrives

### Requirement: A workspace group expands into that workspace's sections

Each workspace group SHALL carry a control that expands and collapses it, and SHALL report whether
it is currently expanded to assistive technology. An expanded group SHALL contain a link to each of
that workspace's sections — Chat, Needs you, Board, Live, Roles, Runs, Usage, Knowledge and Settings
— in the same order the app uses for the active workspace, each addressing that section of that
workspace.

A collapsed group SHALL show its header, including its signals, and none of its section links.

The group of the workspace the app is currently showing SHALL always be expanded and SHALL NOT be
collapsible, so the section being viewed is never hidden.

#### Scenario: Expanding another workspace

- **WHEN** the human expands the group of a workspace that is not the active one
- **THEN** that group's section links become visible, each addressing that workspace, including Live

#### Scenario: Collapsing

- **WHEN** the human collapses an expanded group of a non-active workspace
- **THEN** that group's section links are no longer shown and its header, with its count, remains

#### Scenario: The active workspace cannot be collapsed

- **WHEN** the sidebar renders the group of the workspace currently being shown
- **THEN** that group is expanded and offers no control that would collapse it

### Requirement: Expansion state survives a reload

Which workspace groups are expanded SHALL be remembered on the device and restored when the app is
loaded again. When nothing has been remembered, only the active workspace's group SHALL start
expanded. A remembered workspace that the daemon no longer reports SHALL be ignored without error.

Remembering SHALL be best-effort: when the device refuses to store it, the sidebar SHALL keep
working for the session and SHALL NOT surface an error.

#### Scenario: Reload keeps what was open

- **WHEN** the human expands two workspaces and then reloads the app
- **THEN** those two groups are expanded again

#### Scenario: First visit

- **WHEN** the app is loaded on a device that has remembered nothing
- **THEN** only the active workspace's group is expanded

#### Scenario: Storage is unavailable

- **WHEN** the device refuses to persist the expansion state
- **THEN** expanding and collapsing still work for the session and no error is shown

### Requirement: The active section and active workspace are visible

When the app is showing a workspace page, the sidebar SHALL mark that workspace group as the active
one, and within it SHALL mark the section link matching the current location. Exactly one workspace
SHALL be marked active at a time, and a section link in a non-active workspace's group SHALL NOT be
marked active even when its section matches the current one.

When the app is showing a global Needs you, Live, Chats, Incidents, Map, Scheduled or Settings page,
no workspace group SHALL be marked active, and the matching link in the global section SHALL be
marked as the current one.

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

#### Scenario: Showing global Incidents

- **WHEN** the app is showing the global Incidents page
- **THEN** no workspace group is marked active, and the global section's Incidents link is marked as
  the current one

#### Scenario: Showing global Map

- **WHEN** the app is showing the global Map page
- **THEN** no workspace group is marked active, and the global section's Map link is marked as the
  current one

#### Scenario: Showing global Scheduled

- **WHEN** the app is showing the global Scheduled page
- **THEN** no workspace group is marked active, and the global section's Scheduled link is marked as
  the current one

### Requirement: Navigating to another workspace switches context without a reload

Following a section link in another workspace's group SHALL navigate to that section of that
workspace within the running application, without a document reload. On arrival the app SHALL make
that workspace the one it is showing: it SHALL subscribe to that workspace's event stream, release
the previous workspace's subscription, read subsequent data from that workspace, and remember it as
the workspace to open next time the app is started.

#### Scenario: Jumping from one workspace's chat to another's board

- **WHEN** the human follows workspace B's Board link while workspace A's chat is shown
- **THEN** the app shows B's board without reloading the document, B becomes the active workspace,
  and the app is subscribed to B's events and no longer to A's

#### Scenario: Reopening the app afterwards

- **WHEN** the app is started again on the same device after that jump
- **THEN** it opens on workspace B

### Requirement: Starting a workspace stays reachable from the sidebar

The sidebar SHALL offer an action that begins creating a new workspace, reachable without opening
any menu.

#### Scenario: Creating another workspace

- **WHEN** the human activates the new-workspace action in the sidebar
- **THEN** the app goes to the workspace-creation flow

### Requirement: Section shortcuts and the palette act on the active workspace

The keyboard shortcuts for the sections SHALL navigate to that section of the active workspace, and
SHALL keep doing so however many workspace groups are listed or expanded. The command palette SHALL
keep offering a command that switches to each other workspace.

The sidebar SHALL show the shortcut hint for a section only in the active workspace's group, since
that is the only group the shortcuts reach.

#### Scenario: A shortcut with two workspaces expanded

- **WHEN** the human presses the Board shortcut while the active workspace is A and B's group is
  also expanded
- **THEN** the app goes to A's board

#### Scenario: Switching from the palette

- **WHEN** the human opens the command palette
- **THEN** a command to switch to each other workspace is offered

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

### Requirement: Chat's reading position survives a workspace switch

The conductor chat SHALL keep, for the duration of the session and per workspace, the position the
human scrolled its message list to. Only a position the human chose SHALL be kept: the list's own
scrolling — opening at its newest message, and following content that arrives while the human is at
the bottom — SHALL NOT be recorded as a reading position, however far from the bottom the frames of
it pass.

Returning to a workspace's chat SHALL restore that workspace's position when the list had been
scrolled away from its newest message; when it was at the newest message, or was never scrolled away
from it, the chat SHALL simply open at the newest message. A position SHALL be restored only once
that chat's history has loaded, so that it is put back against the messages it was measured against
and never against the empty list shown before them. Each workspace's position SHALL be kept
separately from every other workspace's, and restoring one SHALL NOT consume another's.

Unsent composer text is outside this capability.

#### Scenario: Returning to a chat that was scrolled up

- **WHEN** the human scrolls workspace A's chat up into its history, jumps to workspace B's board,
  and returns to A's chat
- **THEN** A's chat is showing the part of the history it was left at

#### Scenario: Two workspaces read at different points

- **WHEN** the human has scrolled A's chat into its history while B's chat is at its newest message
- **THEN** returning to each shows that workspace's own position

#### Scenario: A chat left at the newest message

- **WHEN** the human leaves A's chat at its newest message and returns to it
- **THEN** A's chat opens at its newest message and keeps following new ones

#### Scenario: A chat that only ever scrolled itself

- **WHEN** the human opens a workspace's chat, lets it open at its newest message and follow a reply
  as it arrives, and leaves without scrolling the list themselves
- **THEN** returning shows the newest message, not a point the list's own scrolling passed through,
  and the chat keeps following

#### Scenario: The history has not loaded yet

- **WHEN** a chat with a kept position is opened and its history has not arrived
- **THEN** nothing is put back until the history is there, and the position is then restored against
  it

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

### Requirement: A global section sits above the workspace list

On a desktop viewport the sidebar SHALL show a global section above the workspace list, containing
a link named Needs you, a link named Live, a link named Chats, a link named Incidents, a link named
Map, a link named Scheduled and a link named Settings, in that order. Those links SHALL address the
daemon-wide pages, not a workspace. The section SHALL be present whether or not a workspace is
currently being shown, and whether or not the workspace list has loaded.

The global section SHALL NOT replace any workspace group's own Needs you, Live or Chat links.

#### Scenario: The global section is above the workspaces

- **WHEN** the sidebar is shown on a desktop viewport
- **THEN** Needs you, Live, Chats, Incidents, Map, Scheduled and Settings links appear above the
  workspace list

#### Scenario: Needs you in the global section opens global Needs you

- **WHEN** the human activates Needs you in the sidebar's global section
- **THEN** the app shows the global Needs you page without a document reload

#### Scenario: Live in the global section opens global Live

- **WHEN** the human activates Live in the sidebar's global section
- **THEN** the app shows the global Live page without a document reload

#### Scenario: Chats in the global section opens global Chats

- **WHEN** the human activates Chats in the sidebar's global section
- **THEN** the app shows the global Chats page without a document reload

#### Scenario: Incidents in the global section opens global Incidents

- **WHEN** the human activates Incidents in the sidebar's global section
- **THEN** the app shows the global Incidents page without a document reload

#### Scenario: Map in the global section opens global Map

- **WHEN** the human activates Map in the sidebar's global section
- **THEN** the app shows the global Map page without a document reload

#### Scenario: Scheduled in the global section opens global Scheduled

- **WHEN** the human activates Scheduled in the sidebar's global section
- **THEN** the app shows the global Scheduled page without a document reload

#### Scenario: The section is there before workspaces load

- **WHEN** the sidebar renders before the workspace list has loaded
- **THEN** the global Needs you, Live, Chats, Incidents, Map, Scheduled and Settings links are
  already shown

### Requirement: Opening a global page does not switch workspace context

Following a global Needs you, Live, Chats, Incidents, Map, Scheduled or Settings link SHALL navigate
within the running application without a document reload, SHALL NOT mark any workspace group as the
active one, and SHALL NOT change the workspace remembered for the next time the app is started.

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

#### Scenario: Jumping to global Incidents does not switch workspace

- **WHEN** the human is viewing workspace A's board and activates Incidents in the global section
- **THEN** the app shows the global Incidents page, A's group is no longer marked active, and the
  workspace remembered for the next launch is still A

#### Scenario: Jumping to global Scheduled does not switch workspace

- **WHEN** the human is viewing workspace A's board and activates Scheduled in the global section
- **THEN** the app shows the global Scheduled page, A's group is no longer marked active, and the
  workspace remembered for the next launch is still A

### Requirement: Global pages render without a workspace provider

The global Needs you, Live, Chats, Incidents, Map, Scheduled and Settings pages SHALL load and
render when the URL has no workspace id. Shared chrome on those pages SHALL NOT require a workspace
to be the active one, and SHALL NOT throw because no workspace context is present.

Visiting any of those pages SHALL NOT change the workspace remembered for the next time the app is
started. Per-workspace pages under a workspace path SHALL keep wrapping that workspace as the
active one.

#### Scenario: Global Needs you loads with no workspace in the URL

- **WHEN** the app opens the global Needs you page and no workspace is in the URL
- **THEN** the page renders, it does not show an error that workspace context is missing, and the
  workspace remembered for the next launch is unchanged

#### Scenario: The other global pages load the same way

- **WHEN** the app opens global Live, Chats, Incidents, Map, Scheduled or Settings and no workspace
  is in the URL
- **THEN** each page renders without an error that workspace context is missing, and the workspace
  remembered for the next launch is unchanged

#### Scenario: A per-workspace page still has a workspace

- **WHEN** the app opens a workspace's board
- **THEN** that workspace is the active one and the page still renders
