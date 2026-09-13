# workspace-navigation/live-floor Specification

## Purpose
TBD - created by archiving change vs-152-show-a-live-grid-of-working-agents-and-t. Update Purpose after archive.

## Requirements

### Requirement: A workspace has a Live page of currently-working workers

The web app SHALL provide an addressable Live page per workspace, at a path of that workspace, that
shows the workers currently working on tickets in that workspace. The page SHALL be a first-class
workspace section, reachable from the workspace chrome on desktop and from the destinations the
phone's tabs leave out on a phone, without typing a URL.

The page SHALL show one cell per such worker and SHALL NOT show the conductor.

#### Scenario: Opening Live from the desktop chrome

- **WHEN** the human activates Live in a workspace's section list
- **THEN** the app shows that workspace's Live page without a document reload

#### Scenario: Opening Live from a phone

- **WHEN** the human opens More on a phone and chooses Live
- **THEN** the app shows the active workspace's Live page

#### Scenario: The conductor is not a cell

- **WHEN** the conductor is running a turn and Live is open
- **THEN** the grid has no cell for the conductor

### Requirement: The working set is live workers on tickets

A cell SHALL exist for a worker that is currently live (`provisioning`, `active` or `running`) and
that holds a ticket. A worker that is paused, idle, in error, done or retired SHALL NOT have a cell,
even when it still holds a ticket. A live worker with no ticket SHALL NOT have a cell.

The working set SHALL be the same liveness rule the board already uses to decide who is on a ticket
right now, so the Live page and the board do not disagree about whether a given worker is working.

#### Scenario: Several workers are live on tickets

- **WHEN** three workers are live on tickets in the workspace and one other worker is paused
- **THEN** the Live page shows exactly three cells, and the paused worker is not among them

#### Scenario: A paused worker is excluded

- **WHEN** a worker on a ticket is paused
- **THEN** that worker has no cell on the Live page

#### Scenario: An idle worker is excluded

- **WHEN** a worker exists but is not live
- **THEN** that worker has no cell on the Live page

### Requirement: Each cell identifies the worker and the ticket

Each cell SHALL show the worker's name (the role it was spawned from, including the instance when a
role has several live workers) and the ticket's identifier and title. The ticket identity SHALL be a
link to that ticket. The cell SHALL NOT offer steering, attaching, pausing, resuming or cancelling.

#### Scenario: A cell names the worker and the ticket

- **WHEN** a live worker named from the Frontend Engineer role is on ticket ACME-42 titled "Dark mode"
- **THEN** that worker's cell shows the worker's name, ACME-42 and "Dark mode"

#### Scenario: The ticket is reachable from the cell

- **WHEN** the human activates the ticket identity on a cell
- **THEN** the app opens that ticket

#### Scenario: The cell is not a control surface

- **WHEN** a cell is shown
- **THEN** it offers no control that steers, attaches to, pauses, resumes or cancels the worker

### Requirement: Each cell streams that worker's live output

While a cell's worker has an in-progress run, the cell SHALL render that run's transcript as events
arrive, using the same live run-event stream the ticket page and the Run page already use. The
transcript SHALL scroll inside the cell and SHALL NOT drag the page.

A live worker that holds a ticket but has no in-progress run SHALL still occupy a cell, identified,
and SHALL NOT be omitted until a run starts.

A dropped stream SHALL be visible on the cell that owns it (`live-streams/connection-state`) and
SHALL recover without a page reload.

#### Scenario: Output streams into the cell

- **WHEN** a live worker's in-progress run produces assistant text
- **THEN** that text appears in that worker's cell before the turn finishes

#### Scenario: Between turns

- **WHEN** a worker is live on a ticket and has no in-progress run
- **THEN** the worker still has a cell, and that cell does not look like an empty slot in the grid

#### Scenario: The stream drops

- **WHEN** a cell's run-event stream disconnects
- **THEN** that cell shows the stream is reconnecting or offline, and the rest of the grid is unaffected

### Requirement: The grid updates without a reload

When a worker becomes live on a ticket, a cell for it SHALL appear. When a worker leaves the live
set, its cell SHALL disappear. When a remaining worker's in-progress run starts or finishes, that
cell SHALL update. None of these SHALL require a document reload, and any remaining live workers
SHALL keep their cells.

#### Scenario: A worker starts work

- **WHEN** a worker becomes live on a ticket while Live is open
- **THEN** a cell for that worker appears without a reload

#### Scenario: A worker stops work

- **WHEN** a live worker on a ticket is paused or retires while Live is open
- **THEN** that worker's cell disappears without a reload, and any remaining live workers stay

#### Scenario: A turn starts on an existing cell

- **WHEN** a live worker that was between turns starts an in-progress run
- **THEN** that cell begins streaming that run's output, without a reload

### Requirement: Empty, loading and error states are explicit

While the working set has not yet loaded, the page SHALL show a loading state distinguishable from
empty. When the working set has loaded and contains no live worker on a ticket, the page SHALL show
a worded empty state and SHALL NOT fill the grid with paused, idle or historical workers. When the
working set cannot be loaded, the page SHALL show an error and a way to retry, and SHALL NOT pretend
the workspace is idle.

#### Scenario: Nobody is working

- **WHEN** the working set has loaded and no worker is live on a ticket
- **THEN** the page says so in words, with no cells

#### Scenario: The working set is still loading

- **WHEN** the Live page is open and the working set has not arrived
- **THEN** the page shows a loading state, not the empty state

#### Scenario: The working set failed to load

- **WHEN** the request for the working set fails
- **THEN** the page shows that it could not load and offers retry, and does not show the empty state

### Requirement: A live cell can be resized by dragging and the grid reflows

On a viewport wide enough for more than one column, each Live cell SHALL offer a drag handle (an
edge or corner) that makes that cell larger or smaller. The grid SHALL reflow around the new size so
every remaining cell stays on screen and usable: growing one cell SHALL NOT overlay its neighbours
and SHALL NOT leave an unusable hole the human cannot recover from.

The size space SHALL be fine enough that dragging reads as continuous resizing rather than snapping
between a handful of discrete sizes. At desktop (`xl`) width the grid SHALL offer at least twelve
distinct widths; at the intermediate (`sm`) breakpoint it SHALL offer at least eight. Height SHALL
offer at least eight distinct sizes, not two.

A cell that has never been resized SHALL occupy half the grid's width at the `sm` and `xl`
breakpoints, and the full grid's width on a one-column viewport — its equal slot — whatever the
chosen width and height granularity. A handle that is pressed and released without moving SHALL
change nothing. Resetting a cell (the handle's reset action) SHALL return it to that equal slot.

The chosen size SHALL last for the rest of the tab session, including a reload of the Live page in
the same tab. It SHALL NOT be required to survive closing the tab, switching devices, or a worker
that has left the live set. A browser that refuses storage SHALL still resize for the session. A
size saved before the equal slot's width changed SHALL keep resizing and persisting exactly as it
did before, since only the never-resized default is affected.

Empty, loading and error states SHALL NOT grow a resize handle.

The cell SHALL remain a link, not a control surface: resizing SHALL NOT steer, attach, pause,
resume, cancel or hide the worker.

#### Scenario: Dragging a handle makes that cell larger

- **WHEN** two or more live workers have cells on a multi-column Live page and the human drags one
  cell's handle to make it larger
- **THEN** that cell occupies more of the grid than an unresized neighbour, and the neighbours
  reflow around it rather than being covered

#### Scenario: Dragging a handle makes that cell smaller

- **WHEN** a cell has been made larger than the equal slot and the human drags its handle to shrink it
- **THEN** that cell occupies less of the grid, down to no smaller than the equal slot, and the
  neighbours reflow into the space it freed

#### Scenario: Width steps read as continuous at desktop width

- **WHEN** the Live page is shown at desktop (`xl`) width and the human drags a cell's handle
  across the full width available to it
- **THEN** the cell can land on at least twelve distinct widths on the way, not three

#### Scenario: Height has a comparable range to width

- **WHEN** the human drags a cell's handle across the full height available to it
- **THEN** the cell can land on at least eight distinct heights on the way, not two

#### Scenario: A press without a move changes nothing

- **WHEN** the human presses a cell's resize handle and releases it without moving
- **THEN** that cell stays the size it was

#### Scenario: A never-resized cell is half the grid at desktop width

- **WHEN** the Live page is shown at desktop (`xl`) width and a live worker's cell has never been
  resized
- **THEN** that cell occupies half the grid's width, so two cells read per row

#### Scenario: A never-resized cell is half the grid at the intermediate breakpoint

- **WHEN** the Live page is shown at the intermediate (`sm`) breakpoint and a live worker's cell has
  never been resized
- **THEN** that cell occupies half the grid's width, so two cells read per row

#### Scenario: A never-resized cell is the full width on a phone

- **WHEN** the Live page is shown at a one-column (phone) viewport and a live worker's cell has
  never been resized
- **THEN** that cell occupies the full grid's width, so one cell reads per row

#### Scenario: Reset returns the equal slot

- **WHEN** a cell has been resized and the human resets it
- **THEN** that cell occupies the equal slot again, at whatever width the current breakpoint gives it

#### Scenario: The size survives a reload in the same tab

- **WHEN** the human has resized a still-live worker's cell and reloads the Live page in the same tab
- **THEN** that worker's cell opens at the size they chose

#### Scenario: A size saved under the previous equal slot keeps working

- **WHEN** a live worker's cell was explicitly resized and saved before the equal slot's width
  changed at `xl`
- **THEN** that saved size still opens and resizes exactly as it did before, unaffected by the new
  equal slot

#### Scenario: Empty and loading have no handle

- **WHEN** the Live page is showing its loading state or its empty state
- **THEN** no resize handle is present

### Requirement: At phone width a cell expands by tap, not by dragging

On a one-column viewport, a Live cell SHALL NOT offer a drag-resize handle. Dragging at that width
fights page scrolling. Each cell SHALL instead offer a control that expands that cell (a larger
share of the transcript) and that restores it when activated again.

Expanding one cell SHALL NOT hide the others and SHALL NOT change who is in the live set. Empty,
loading and error states SHALL NOT grow the expand control.

#### Scenario: Phone has expand, not drag

- **WHEN** the Live page is shown at phone width with at least one live cell
- **THEN** each cell has an expand control and no drag-resize handle

#### Scenario: Tapping expand enlarges that cell

- **WHEN** the human activates a cell's expand control at phone width
- **THEN** that cell's transcript occupies a larger share of the page than an unexpanded neighbour,
  and the other cells remain visible

#### Scenario: Tapping again restores the cell

- **WHEN** an expanded cell's expand control is activated again
- **THEN** that cell returns to the unexpanded size

### Requirement: A worker on a terminal ticket has no Live cell

When a ticket reaches `done` or `cancelled`, its worker SHALL NOT have a cell on the Live page,
even if it still holds that ticket id. A live worker on a ticket that is not terminal SHALL still
have a cell between turns, as this capability already requires.

#### Scenario: A done ticket's worker is not on Live

- **WHEN** a worker's ticket reaches `done`
- **THEN** that worker has no cell on the Live page

#### Scenario: A cancelled ticket's worker is not on Live

- **WHEN** a worker's ticket reaches `cancelled`
- **THEN** that worker has no cell on the Live page

### Requirement: Consecutive identical tool calls collapse in a live cell's transcript

When a Live cell streams a run's transcript, consecutive tool calls whose tool name is the same
SHALL collapse into one row that shows that name and the number of calls in the run (for example
`Read ×10`). A single call that is not adjacent to another call of the same name SHALL remain a
single row and SHALL NOT show a count.

Activating a counted row SHALL expand it in place to list each invocation, in order, with the same
path or args (and result body) each call shows today. Activating it again SHALL restore the counted
row.

A different tool name SHALL start a new group. A non-tool line (assistant text, a phase marker, a
status line) SHALL also split a run. Order SHALL be preserved.

While events are still arriving, as a run of same-name calls grows, the counted row's number SHALL
update without a page reload.

#### Scenario: Ten consecutive Reads collapse

- **WHEN** a live cell's in-progress run records ten consecutive Read tool calls
- **THEN** the cell shows one counted Read row, not ten separate rows

#### Scenario: Expanding lists each call

- **WHEN** the human activates a counted Read ×10 row
- **THEN** the ten calls are listed in order, each with the path or args it already shows today

#### Scenario: A mixed sequence stays three groups

- **WHEN** a live cell's transcript is Read, then Glob, then Read
- **THEN** it shows three groups, not one

#### Scenario: A single call is not counted

- **WHEN** a live cell's transcript has one Read that is not adjacent to another Read
- **THEN** that call renders as a single row without a count

#### Scenario: The count grows as calls arrive

- **WHEN** a live cell already shows Read ×3 and another consecutive Read arrives
- **THEN** the row becomes Read ×4 without a reload
