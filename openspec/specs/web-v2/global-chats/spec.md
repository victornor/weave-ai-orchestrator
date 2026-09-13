# web-v2/global-chats Specification

## Purpose
The V2 Global Chats screen: every workspace's conversation with its weaver side by side in one row of
panes, each pane the V2 Chat screen, with a layout the human rearranges and the device remembers.

## Requirements

### Requirement: One pane per workspace, each running the V2 Chat screen

The screen SHALL render one pane per workspace the daemon reports, in the remembered order, and each
pane SHALL render that workspace's V2 Chat screen (the conversation, the composer, the decisions pane
and Chat's own status bar) rather than a V1 chat. Each pane SHALL resolve its own workspace, so two
panes never read each other's data. The screen SHALL show an empty state when the daemon reports no
workspaces and a loading state before the list resolves.

#### Scenario: A pane per workspace

- **WHEN** the daemon reports three workspaces
- **THEN** three panes render, each showing its workspace's V2 Chat screen

#### Scenario: A pane's data belongs to its workspace

- **WHEN** two panes are shown
- **THEN** each pane's conversation, decisions and status bar come from that pane's own workspace

#### Scenario: No workspaces

- **WHEN** the daemon reports no workspaces
- **THEN** the screen shows an empty state instead of a pane row

### Requirement: Panes resize, collapse to a sliver, and reorder

An expanded pane SHALL be resizable against its right neighbour by dragging the separator between them,
and by keyboard, within bounds that keep both panes usable. A pane SHALL be collapsible to a sliver
that keeps its workspace name readable and expands again on activation, and the collapse control's arrow
SHALL point in the direction the pane collapses. A pane SHALL be reorderable by dragging it to a new
position and by a move-left / move-right menu on its header. The last expanded pane SHALL NOT be
collapsible, so the screen always has one focused pane while it has a workspace. On a phone, an expanded
pane SHALL take the full width.

#### Scenario: Dragging a separator

- **WHEN** the human drags the separator between two expanded panes
- **THEN** the left pane grows or shrinks and the right pane takes the rest, each staying within its
  usable share

#### Scenario: Collapsing a pane

- **WHEN** the human activates a pane's collapse control
- **THEN** the pane becomes a sliver showing its workspace name, and activating the sliver expands it
  again

#### Scenario: The last expanded pane cannot collapse

- **WHEN** only one pane is expanded and the human activates its collapse control
- **THEN** the layout is unchanged and the pane stays expanded

#### Scenario: Reordering a pane

- **WHEN** the human moves a pane left or right from its header menu, or drags it to a new position
- **THEN** the panes are reordered accordingly

#### Scenario: A phone pane fills the width

- **WHEN** the screen is shown at phone width
- **THEN** an expanded pane takes the full width and the panes scroll horizontally

### Requirement: The layout is remembered on the device

The pane order, each pane's width share and each pane's collapsed state SHALL be remembered on the
device and restored on the next visit, reconciled against the workspaces the daemon reports now. A
workspace the daemon no longer reports SHALL be dropped, a newly listed workspace SHALL be appended
expanded, and the remembered layout SHALL be stored apart from V1's so neither version reads the
other's.

#### Scenario: A return visit restores the layout

- **WHEN** the human rearranges the panes and returns to the screen later
- **THEN** the panes are ordered, sized and collapsed as they were left

#### Scenario: The workspace list changes

- **WHEN** a workspace is removed from and another added to the daemon's list
- **THEN** the removed pane is dropped, the new one is appended expanded, and the rest keep their
  remembered order, width and collapse

#### Scenario: V1's layout is untouched

- **WHEN** V2 remembers a layout
- **THEN** it is stored under V2's own key and V1's Global Chats layout is neither read nor written

### Requirement: Exactly one pane is live at a time

Exactly one pane SHALL be live at a time — the focused pane — and it SHALL hold the workspace event
subscription and the run-tail stream to its weaver's in-flight run, so neither the screen's connection
count nor its number of live run streams grows with the number of workspaces. Every other pane SHALL
still show its workspace's history, decisions and composer from ordinary queries, and SHALL NOT hold a
live run stream even when its weaver is running. Any per-pane global listener or keyboard shortcut SHALL
be active only in the focused pane, matching V1's `focused` gate. Choosing a pane's header SHALL make it
the focused pane and catch its data up.

#### Scenario: One subscription and one run stream

- **WHEN** several panes are shown
- **THEN** only the focused pane holds a live event subscription and a live run stream

#### Scenario: Two weavers running, one pane focused

- **WHEN** two panes' weavers are each running a turn and the human focuses one pane
- **THEN** only the focused pane's run stream is live, and the other pane shows its history without a
  live run stream

#### Scenario: A shortcut fires once

- **WHEN** a per-pane keyboard shortcut or global listener is registered and several panes are shown
- **THEN** it is active in the focused pane only

#### Scenario: Focusing a pane

- **WHEN** the human activates a non-focused pane's header
- **THEN** that pane becomes the focused one and its data is refreshed

#### Scenario: A collapsed focused pane

- **WHEN** the focused pane is collapsed
- **THEN** the nearest still-expanded pane becomes the focused one
