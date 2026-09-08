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
that workspace's sections — Chat, Needs you, Board, Team, Runs, Usage, Knowledge and Settings — in
the same order the app uses for the active workspace, each addressing that section of that
workspace.

A collapsed group SHALL show its header, including its signals, and none of its section links.

The group of the workspace the app is currently showing SHALL always be expanded and SHALL NOT be
collapsible, so the section being viewed is never hidden.

#### Scenario: Expanding another workspace

- **WHEN** the human expands the group of a workspace that is not the active one
- **THEN** that group's eight section links become visible, each addressing that workspace

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

The sidebar SHALL mark the workspace group the app is currently showing as the active one, and
within it SHALL mark the section link matching the current location. Exactly one workspace SHALL be
marked active at a time, and a section link in a non-active workspace's group SHALL NOT be marked
active even when its section matches the current one.

#### Scenario: Showing a board

- **WHEN** the app is showing workspace A's board and workspace B's group is also expanded
- **THEN** A's group is marked active and its Board link is marked as the current one, and B's Board
  link is not marked

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
its section links and no project list, without an empty block or an error. When a workspace's project
fetch fails, that group alone SHALL show that it could not load its projects; every other group,
expanded or collapsed, SHALL be unaffected and SHALL keep working.

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
- **THEN** its group shows its section links and no project list, and no error is shown

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
