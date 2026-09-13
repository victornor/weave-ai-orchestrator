## ADDED Requirements

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

## MODIFIED Requirements

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
