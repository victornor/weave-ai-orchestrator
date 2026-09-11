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

Only the focused pane (see "Exactly one pane is live at a time" below) SHALL stream a running
conductor turn's activity in real time. A turn running in an unfocused pane's
workspace SHALL still be reflected in that pane — the working indicator and the finished reply —
once the pane has the data to show it, but SHALL NOT stream token-by-token while unfocused.

#### Scenario: A message in Alpha's pane

- **WHEN** the human sends a message in the Alpha pane
- **THEN** the message is posted to Alpha's primary web conductor thread, and the reply appears in
  the Alpha pane

#### Scenario: Beta's pane is unaffected

- **WHEN** the human sends a message in the Alpha pane while the Beta pane is also showing
- **THEN** Beta's thread is not posted to and Beta's pane does not show Alpha's message

#### Scenario: A live turn stays in its pane

- **WHEN** Alpha's conductor is running a turn, Alpha is the focused pane, and global Chats is
  open
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

### Requirement: Exactly one pane is live at a time

Global Chats SHALL hold at most one live workspace subscription at a time, regardless of how many
workspaces are listed, so the page's own connections do not scale with workspace count. The pane
whose workspace this subscription belongs to is the focused pane; it defaults to the first listed
workspace. The human SHALL be able to make any other pane the focused one by choosing it, at which
point the previously focused pane's live subscription closes and the newly focused pane's opens.

An unfocused pane SHALL still show that workspace's conductor chat — its loaded history, its open
decisions, its composer — from the data already fetched for it; it SHALL NOT be blank or
unusable for not being focused.

Becoming the focused pane SHALL refresh that workspace's messages and decisions so a pane that was
unfocused while its conductor did something is caught up rather than showing what it last held
while unfocused.

#### Scenario: The default focused pane

- **WHEN** global Chats opens with Alpha, Beta and Gamma listed
- **THEN** Alpha is the focused pane and Beta and Gamma are not

#### Scenario: Choosing a different pane

- **WHEN** the human chooses the Beta pane while Alpha is focused
- **THEN** Alpha's live subscription closes, Beta's opens, and Beta becomes the focused pane

#### Scenario: An unfocused pane still works

- **WHEN** Beta is not the focused pane
- **THEN** the Beta pane still shows Beta's loaded history and open decisions, and the human can
  still send a message in it

#### Scenario: Catching up on focus

- **WHEN** the human chooses the Beta pane and Beta's conductor replied while Beta was unfocused
- **THEN** the Beta pane shows that reply once it becomes focused

#### Scenario: Connections do not grow with workspace count

- **WHEN** ten workspaces are listed on global Chats
- **THEN** the page holds exactly one live workspace subscription open, the same as it would for
  two

### Requirement: A pane’s history loads over REST without a live subscription

Each global-Chats pane SHALL populate its conductor thread from ordinary requests for that workspace’s threads and messages. Those requests SHALL NOT wait for a live workspace subscription to be open, connected, or caught up. An unfocused pane SHALL still make the thread and messages requests (or use already-fetched data) so it is not blank for lack of focus.

The messages request completing, or failing with an explicit error and retry, SHALL be what takes a pane off its loading state. Label data used to decorate the conversation (tickets, workers, traces) SHALL NOT gate that transition.

#### Scenario: History appears without a stream

- **WHEN** global Chats opens and the focused pane’s messages request completes while its live subscription is still connecting
- **THEN** that pane shows the thread history

#### Scenario: An unfocused pane still fetches history

- **WHEN** global Chats opens with more than one workspace and a pane is not focused
- **THEN** that pane still shows its workspace’s thread once its messages request completes, without opening a live subscription

#### Scenario: A messages failure is visible

- **WHEN** a pane’s messages request fails
- **THEN** that pane shows the failure and a way to retry, and is not left on the loading state indefinitely

### Requirement: Thread and messages requests are not queued behind chat decorations

On global Chats, each pane SHALL request that workspace’s thread list and messages without first waiting for the pane’s tickets, workers, retired-worker, or run-trace summary requests to finish. Those decoration requests MAY run afterwards or in parallel, but they SHALL NOT be what blocks the history from appearing.

A request whose only purpose is resolving identifier chips or dispatch labels SHALL NOT download each ticket’s full description.

#### Scenario: Messages are requested up front

- **WHEN** a global Chats pane mounts
- **THEN** it requests that workspace’s web threads and, once a thread id is known, that thread’s messages, without waiting for tickets, workers, or traces to return

#### Scenario: Ticket labels do not ship descriptions

- **WHEN** a pane fetches tickets in order to render dispatch labels or identifier chips in the chat
- **THEN** the payload does not include each ticket’s description body
