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
whose workspace this subscription belongs to is the focused pane; it defaults to the first pane in
the stored layout. The human SHALL be able to make any other expanded pane the focused one by
choosing it, at which point the previously focused pane's live subscription closes and the newly
focused pane's opens.

A collapsed pane SHALL NOT be the focused pane and SHALL NOT hold the live subscription. Collapsing
the focused pane SHALL move focus to the nearest expanded pane — the previous pane if one is
expanded, otherwise the next. Expanding a collapsed pane SHALL make it the focused pane.

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

#### Scenario: Collapsing the focused pane moves focus

- **WHEN** the human collapses the pane that is currently focused
- **THEN** focus moves to the nearest expanded pane and exactly one pane remains live

#### Scenario: A collapsed pane is never live

- **WHEN** a pane is collapsed
- **THEN** it holds no live workspace subscription, and choosing its sliver expands it and makes it
  the focused pane

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

### Requirement: Panes resize by dragging the separator between them

The page SHALL render a vertical separator between each pair of adjacent expanded panes. Operating a
separator SHALL change the widths of only the two panes it sits between: the pane on one side grows
by the amount the other shrinks, and every other pane's width SHALL be unchanged. Each expanded pane
SHALL keep a minimum readable width, and a drag or key press that would take either neighbour below
it SHALL leave that neighbour at the minimum. The separator SHALL carry `role="separator"` with
`aria-orientation="vertical"`, `aria-valuenow`, `aria-valuemin` and `aria-valuemax`, and SHALL use
`touch-action: none` so a drag does not scroll the page. Arrow keys SHALL resize it, and double-click
SHALL reset its two neighbours to equal widths. On a phone-width viewport, dragging-to-resize SHALL
be unavailable and the page SHALL rely on horizontal scrolling.

#### Scenario: Dragging a separator moves width between two neighbours

- **WHEN** the human drags the separator between pane A and pane B to the right
- **THEN** A becomes wider and B narrower by the same amount

#### Scenario: A third pane is untouched

- **WHEN** the human drags the separator between A and B while pane C is also expanded
- **THEN** C's width does not change

#### Scenario: A drag stops at the minimum width

- **WHEN** the human drags the separator far enough that the shrinking pane would be narrower than
  the minimum readable width
- **THEN** the shrinking pane stays at the minimum and the drag has no further effect on it

#### Scenario: Keyboard resize

- **WHEN** the human focuses a separator and presses an arrow key
- **THEN** the two neighbouring panes' widths change in that direction

#### Scenario: Double-click resets the pair

- **WHEN** the human double-clicks a separator whose two neighbours have been resized unequally
- **THEN** those two panes return to equal widths

#### Scenario: Phone-width has no resize handles

- **WHEN** the viewport is phone width
- **THEN** the separators do not offer drag resizing and the panes remain reachable by horizontal
  scrolling

### Requirement: A pane collapses to a sliver and expands

Each pane header SHALL offer a collapse control. A collapsed pane SHALL render as a narrow vertical
strip that identifies its workspace by name (rotated or truncated) and SHALL show that workspace's
needs-you count when one is already available from data the page has fetched. Choosing the strip or
its expand control SHALL restore the pane to the width it had before collapsing. Collapse SHALL NOT
be offered for the only expanded pane: at least one pane SHALL remain expanded while any workspace is
listed. Collapsing and expanding a pane SHALL preserve that chat's composer draft and its reading
position.

#### Scenario: Collapsing renders a sliver

- **WHEN** the human collapses a pane
- **THEN** the pane becomes a narrow vertical strip showing that workspace's name, and its chat body
  is no longer shown

#### Scenario: Expanding restores the previous width

- **WHEN** the human expands a collapsed pane that had been widened before it was collapsed
- **THEN** the pane returns to that width

#### Scenario: The last expanded pane cannot be collapsed

- **WHEN** every other pane is already collapsed
- **THEN** the remaining expanded pane offers no way to collapse it

#### Scenario: A draft survives collapse and expand

- **WHEN** the human types an unsent draft, collapses that pane, and expands it again
- **THEN** the draft is still in that pane's composer

#### Scenario: The reading position survives collapse and expand

- **WHEN** the human scrolls a pane's history, collapses that pane, and expands it again
- **THEN** the pane is scrolled back to where it was left

#### Scenario: The sliver shows the needs-you count

- **WHEN** a collapsed pane's workspace has a needs-you count the page has already fetched
- **THEN** the sliver shows that count

### Requirement: Panes reorder by drag and by menu

The human SHALL be able to move a pane to a different position by dragging its header, with a visible
drop indicator showing where it will land. Each pane header SHALL also offer non-drag "Move left" and
"Move right" controls usable by keyboard and touch. The stored order SHALL determine the panes'
left-to-right sequence. A control that would move a pane past either end SHALL be unavailable.

#### Scenario: Drag reorders with a drop indicator

- **WHEN** the human drags a pane's header over the gap between two other panes
- **THEN** a drop indicator shows the insertion point, and releasing there moves the pane to that
  position

#### Scenario: Move right via the menu

- **WHEN** the human chooses "Move right" on a pane that is not last
- **THEN** that pane swaps places with the pane to its right

#### Scenario: Move left via the menu

- **WHEN** the human chooses "Move left" on a pane that is not first
- **THEN** that pane swaps places with the pane to its left

#### Scenario: The ends are bounded

- **WHEN** the human opens the menu on the first pane
- **THEN** "Move left" is unavailable, and on the last pane "Move right" is unavailable

### Requirement: The pane layout persists per browser

Order, every pane's width and every pane's collapsed state SHALL persist in the browser's
`localStorage`, keyed by workspace id within the stored layout, and SHALL be restored when the page
loads again. A workspace in the saved layout that the daemon no longer reports SHALL be dropped
without disturbing the rest. A workspace the daemon reports that is absent from the saved layout
SHALL be appended as an expanded pane at the default width. Stored widths SHALL be proportional, or
re-clamped when loaded, so a layout saved on a wide viewport remains usable on a narrow one. When
storage is unavailable or holds an unreadable value, the page SHALL still work for that visit.

#### Scenario: The layout comes back after a remount

- **WHEN** the human reorders, resizes or collapses panes and later reloads the page
- **THEN** the same order, widths and collapsed state are shown

#### Scenario: A removed workspace is dropped

- **WHEN** the saved layout names a workspace the daemon no longer reports, alongside workspaces it
  does report
- **THEN** the missing workspace is dropped and the rest keep their saved order, widths and collapsed
  state

#### Scenario: A new workspace is appended

- **WHEN** the daemon reports a workspace that is absent from the saved layout
- **THEN** its pane is appended after the saved panes, expanded, at the default width

#### Scenario: A wide-screen layout loads narrowly

- **WHEN** a layout saved on a wide viewport is loaded on a much narrower one
- **THEN** the panes are still readable and the page does not rely on the saved pixel widths being
  honoured exactly

#### Scenario: Storage is unavailable

- **WHEN** the browser refuses `localStorage` access
- **THEN** the page still renders, resizes, collapses and reorders for that visit, and does not throw
