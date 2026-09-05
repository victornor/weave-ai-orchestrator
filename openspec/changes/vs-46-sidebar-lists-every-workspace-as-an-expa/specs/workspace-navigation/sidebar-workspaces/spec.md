## Purpose

Describes how the web app's sidebar presents every workspace at once — each workspace expandable
into its own sections, its expansion remembered per device — so a human working across several
workspaces reaches any workspace's section in one click, and describes what that navigation does to
the app's workspace context and what the phone shows instead.

## ADDED Requirements

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
active workspace, and SHALL NOT grow a workspace list. The workspace list, with each workspace's
Needs-you count, SHALL instead be shown at the top of Settings, which the More tab opens. Choosing a
workspace there SHALL navigate to that workspace and make it active.

The list SHALL lay out within a 390 px viewport without overlapping the bottom bar or the content
above it.

#### Scenario: Reaching another workspace on a phone

- **WHEN** the human opens More and chooses another workspace from the list
- **THEN** the app shows that workspace and makes it active

#### Scenario: The tab bar is unchanged

- **WHEN** the bottom bar is rendered with several workspaces loaded
- **THEN** it still shows five tabs, all addressing the active workspace

### Requirement: Chat's reading position survives a workspace switch

The conductor chat SHALL keep, for the duration of the session and per workspace, the position its
message list was scrolled to. Returning to a workspace's chat SHALL restore that workspace's
position when the list had been scrolled away from its newest message; when it was at the newest
message, the chat SHALL simply open at the newest message. Each workspace's position SHALL be kept
separately from every other workspace's.

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
