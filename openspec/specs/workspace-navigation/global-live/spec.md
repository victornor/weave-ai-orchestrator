# workspace-navigation/global-live Specification

## Purpose
A daemon-wide Live page that shows every currently-working worker across every workspace this
daemon hosts, using the same live-grid metaphor as the per-workspace Live page, reachable without
picking a workspace first.

## Requirements

### Requirement: A global Live page shows every workspace's working set

The web app SHALL provide an addressable Live page at a path that does not include a workspace id,
reachable from the sidebar's global section and from the phone's More menu, without typing a URL
and without first choosing a workspace.

The page SHALL show one cell per worker that is currently live on a ticket in any workspace this
daemon hosts. Membership SHALL be the same liveness rule the per-workspace Live page uses
(`workspace-navigation/live-floor`): live (`provisioning`, `active` or `running`) and holding a
ticket. The conductor SHALL NOT have a cell. Paused, idle, error, done and retired workers SHALL
NOT have a cell.

Per-workspace Live at a workspace path SHALL keep working unchanged.

#### Scenario: Opening global Live from the sidebar

- **WHEN** the human activates Live in the sidebar's global section
- **THEN** the app shows the global Live page without a document reload and without making a
  workspace the active one

#### Scenario: Opening global Live from a phone

- **WHEN** the human opens More on a phone and chooses the global Live destination
- **THEN** the app shows the global Live page and the menu is dismissed

#### Scenario: Workers from two workspaces appear together

- **WHEN** workspace A has two live workers on tickets and workspace B has one, and global Live is
  open
- **THEN** the page shows exactly three cells

#### Scenario: The conductor is not a cell

- **WHEN** a workspace's conductor is running a turn and global Live is open
- **THEN** the grid has no cell for that conductor

#### Scenario: Per-workspace Live is unchanged

- **WHEN** the human activates Live inside a workspace group's section list
- **THEN** the app shows that workspace's Live page, not the global one

### Requirement: Each cell names its workspace, the worker and the ticket

Each cell SHALL show the workspace's name, the worker's name, and the ticket's identifier and
title. The ticket identity SHALL be a link to that ticket in that workspace. The cell SHALL NOT
offer steering, attaching, pausing, resuming or cancelling.

#### Scenario: A cell names the workspace

- **WHEN** a live worker in workspace Alpha is on ticket ACME-42 titled "Dark mode"
- **THEN** that worker's cell shows Alpha, the worker's name, ACME-42 and "Dark mode"

#### Scenario: The ticket is reachable from the cell

- **WHEN** the human activates the ticket identity on a global Live cell
- **THEN** the app opens that ticket in that worker's workspace

### Requirement: Cells stream, resize and expand as the per-workspace Live page does

While a cell's worker has an in-progress run, the cell SHALL render that run's transcript as events
arrive, scrolling inside the cell without dragging the page. A live worker between turns SHALL
still occupy a cell. A dropped stream SHALL be visible on the cell that owns it and SHALL recover
without a page reload.

On a viewport wide enough for more than one column, each cell SHALL offer the same drag-resize
handle the per-workspace Live page does. On a one-column viewport, each cell SHALL offer tap-to-
expand instead of drag. Empty, loading and error states SHALL NOT grow a handle or expand control.

#### Scenario: Output streams into the cell

- **WHEN** a live worker's in-progress run produces assistant text
- **THEN** that text appears in that worker's cell on the global Live page before the turn finishes

#### Scenario: Between turns

- **WHEN** a worker is live on a ticket and has no in-progress run
- **THEN** the worker still has a cell on the global Live page

#### Scenario: Phone has expand, not drag

- **WHEN** global Live is shown at phone width with at least one live cell
- **THEN** each cell has an expand control and no drag-resize handle

### Requirement: Empty workspaces do not break the page

A workspace that has no live worker on a ticket SHALL contribute no cells and SHALL NOT show an
error of its own. While any workspace's working set has not yet loaded, the page SHALL show a
loading state distinguishable from empty. When every workspace has loaded and none has a live
worker on a ticket, the page SHALL show a worded empty state. When one workspace's working set
cannot be loaded, the page SHALL keep showing cells from the workspaces that did load and SHALL
show that the failed workspace could not load, with a way to retry that workspace; it SHALL NOT
blank the whole page. When the workspace list itself cannot be loaded, the page SHALL show an
error and a way to retry.

When a worker becomes live on a ticket in any workspace, a cell for it SHALL appear. When a worker
leaves the live set, its cell SHALL disappear. None of these SHALL require a document reload.

#### Scenario: Nobody is working anywhere

- **WHEN** every hosted workspace has loaded and no worker is live on a ticket
- **THEN** the page says so in words, with no cells

#### Scenario: One workspace is idle

- **WHEN** workspace A has a live worker on a ticket and workspace B has none
- **THEN** the page shows A's cell and does not show an error for B

#### Scenario: One workspace fails to load

- **WHEN** workspace A's working set fails to load and workspace B's has loaded with a live worker
- **THEN** the page shows B's cell, shows that A could not load, and offers retry for A

#### Scenario: The working set is still loading

- **WHEN** global Live is open and at least one workspace's working set has not arrived
- **THEN** the page shows a loading state, not the empty state

#### Scenario: A worker starts work in another workspace

- **WHEN** a worker becomes live on a ticket in any hosted workspace while global Live is open
- **THEN** a cell for that worker appears without a reload

### Requirement: A worker on a terminal ticket has no global Live cell

When a ticket reaches `done` or `cancelled`, its worker SHALL NOT have a cell on the global Live
page. Membership stays the same liveness rule as per-workspace Live
(`workspace-navigation/live-floor`): a live worker between turns on a ticket that is not terminal
SHALL still have a cell.

#### Scenario: A done ticket's worker is not on global Live

- **WHEN** a worker's ticket in any hosted workspace reaches `done`
- **THEN** that worker has no cell on the global Live page

#### Scenario: A cancelled ticket's worker is not on global Live

- **WHEN** a worker's ticket in any hosted workspace reaches `cancelled`
- **THEN** that worker has no cell on the global Live page
