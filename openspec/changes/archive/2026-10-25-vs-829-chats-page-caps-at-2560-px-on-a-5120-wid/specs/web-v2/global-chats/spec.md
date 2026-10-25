## ADDED Requirements

### Requirement: The pane row fills the viewport at every desktop width

The expanded panes of the Global Chats screen SHALL together fill the width the screen is given, at
every desktop width including a very wide window, with no maximum applied to the row or to a pane. Each
expanded pane SHALL take its share of that width in proportion to its weight, so equal weights divide the
row equally. A collapsed pane SHALL remain a fixed 40 px sliver and SHALL NOT take a share of the
remaining width.

#### Scenario: A very wide window is filled

- **WHEN** the screen is shown in a window about 5120 px wide
- **THEN** the pane row spans the full width between the rail and the window edge, with no empty strip
  at the right

#### Scenario: Two panes split a very wide window evenly

- **WHEN** two workspaces are listed at default weights in a window about 5120 px wide
- **THEN** each pane is about half of the row

#### Scenario: One pane fills the row

- **WHEN** a single workspace is listed and expanded
- **THEN** its pane spans the whole row

#### Scenario: A collapsed pane does not take a share

- **WHEN** one of three panes is collapsed
- **THEN** the collapsed pane stays a 40 px sliver and the two expanded panes divide the rest of the row

#### Scenario: Widths stay across the range

- **WHEN** the window is resized through 1280, 1920, 2560 and 5120 px
- **THEN** the row fills the width at each size and the panes keep their relative shares
