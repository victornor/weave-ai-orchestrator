# conductor-chat/global-chats Specification

## Purpose
A daemon-wide Chats page that shows every workspace's conductor thread side by side, so a human
can read and send in any workspace's conversation from one place without picking a workspace first.

## Requirements

### Requirement: A global Chats page shows one conductor pane per workspace

The web app SHALL provide an addressable Chats page at a path that does not include a workspace id,
reachable from the sidebar's global section and from the phone's More menu, without typing a URL
and without first choosing a workspace.

The page SHALL show one conductor-chat pane per workspace the daemon reports, laid out horizontally
side by side. Each pane SHALL be identified by that workspace's name. A workspace with no web
thread yet SHALL still have a pane, showing the empty composer after the thread is created, the
same way the per-workspace chat does (`conductor-chat/workspace-thread`).

Per-workspace Chat at a workspace path SHALL keep working unchanged.

#### Scenario: Opening global Chats from the sidebar

- **WHEN** the human activates Chats in the sidebar's global section
- **THEN** the app shows the global Chats page without a document reload and without making a
  workspace the active one

#### Scenario: Opening global Chats from a phone

- **WHEN** the human opens More on a phone and chooses the global Chats destination
- **THEN** the app shows the global Chats page and the menu is dismissed

#### Scenario: Two workspaces sit side by side

- **WHEN** the daemon reports workspaces Alpha and Beta and global Chats is open
- **THEN** the page shows two panes, one labelled Alpha and one labelled Beta, laid out
  horizontally

#### Scenario: A workspace with no web thread yet

- **WHEN** a listed workspace has no web thread
- **THEN** that pane creates one for that workspace and shows the empty composer, without
  requesting messages for another workspace's thread

#### Scenario: Per-workspace Chat is unchanged

- **WHEN** the human activates Chat inside a workspace group's section list
- **THEN** the app shows that workspace's Chat page, not the global one

### Requirement: Sending in a pane talks to that workspace's conductor

A message posted in a pane SHALL land on that pane's workspace's primary web conductor thread and
SHALL get the conductor's reply in that same pane. The pane SHALL NOT request messages for a
thread id that belongs to a different workspace. Unsent composer drafts and the chat's reading
position SHALL remain per-workspace as they already are.

A live conductor turn in one workspace SHALL stream in that workspace's pane and SHALL NOT appear
in another pane.

#### Scenario: A message in Alpha's pane

- **WHEN** the human sends a message in the Alpha pane
- **THEN** the message is posted to Alpha's primary web conductor thread, and the reply appears in
  the Alpha pane

#### Scenario: Beta's pane is unaffected

- **WHEN** the human sends a message in the Alpha pane while the Beta pane is also showing
- **THEN** Beta's thread is not posted to and Beta's pane does not show Alpha's message

#### Scenario: A live turn stays in its pane

- **WHEN** Alpha's conductor is running a turn and global Chats is open
- **THEN** that turn's output streams in the Alpha pane and not in any other pane

### Requirement: Empty, loading and partial failure are explicit

While the workspace list has not yet loaded, the page SHALL show a loading state distinguishable
from empty. When the daemon reports no workspaces, the page SHALL show a worded empty state. When
one workspace's thread cannot be loaded, that pane SHALL show the failure and a way to retry, and
every other pane SHALL keep working. When the workspace list itself cannot be loaded, the page
SHALL show an error and a way to retry.

#### Scenario: No workspaces

- **WHEN** the daemon reports no workspaces
- **THEN** the page says so in words, with no panes

#### Scenario: One pane fails

- **WHEN** Alpha's thread fails to load and Beta's has loaded
- **THEN** the Alpha pane shows that it could not load and offers retry, and the Beta pane still
  shows Beta's thread
