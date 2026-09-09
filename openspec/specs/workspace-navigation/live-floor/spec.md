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
