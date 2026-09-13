## ADDED Requirements

### Requirement: A cell keeps the worker's last turn between turns

A cell whose worker has no in-progress run SHALL render that worker's most recent run's transcript,
read from that run's persisted events, and SHALL open no run-event stream for it. The waiting line
SHALL render as a footer below that transcript rather than in place of it. A worker that has never
had a run SHALL show only the waiting line.

A finished run's transcript SHALL include that run's final events even when the run recorded more
events than fit in one page, so the cell shows the end of the turn rather than only its opening.

A cell showing a finished run's transcript SHALL NOT hold one of the run-tail `EventSource` slots
(`MAX_LIVE_RUN_TAILS`); the cap applies to in-progress runs only.

#### Scenario: The last turn stays on screen

- **WHEN** a live worker's most recent run has finished and the worker has no in-progress run
- **THEN** the cell shows that run's transcript with the waiting line as a footer below it, and
  opens no run-event stream for that run

#### Scenario: A long finished run shows its ending

- **WHEN** a live worker's most recent run recorded more events than fit in one page and the worker
  has no in-progress run
- **THEN** the cell's transcript includes that run's final events, not only its first events

#### Scenario: A worker that has never run

- **WHEN** a live worker has never had a run
- **THEN** its cell shows the waiting line alone, with no transcript

#### Scenario: A turn ends

- **WHEN** a worker's in-progress run finishes while the cell is open
- **THEN** the transcript stays on screen and the waiting line appears below it, without a document
  reload

#### Scenario: A finished run takes no tail slot

- **WHEN** the floor has more live cells than `MAX_LIVE_RUN_TAILS` and some of those workers are
  between turns
- **THEN** only in-progress runs occupy tail slots, and a cell showing a finished run's transcript
  opens no `EventSource`

### Requirement: A cell hands off cleanly to the next turn

When a live worker starts a new run after a finished one, the cell SHALL switch to the new run's live
stream without an intervening empty cell: the finished run's transcript SHALL stay visible until the
new run has events to render. A turn separator or marker between the finished transcript and the new
run is permitted. A cell whose first observed run is active SHALL stream it as before.

#### Scenario: A new run starts after a finished one

- **WHEN** a worker whose finished run is on screen starts a new in-progress run
- **THEN** the cell opens the new run's live stream, keeps the finished transcript until the new
  run's events arrive, and then shows the new run's output without a blank cell in between

#### Scenario: The first observed run is live

- **WHEN** a cell opens and its worker's run is already in progress
- **THEN** the cell streams that run as before, with no waiting line

### Requirement: A cell keeps its scroll position when a turn ends

A cell whose in-progress run finishes SHALL keep the scroll position it had: at the bottom when the
human was following the turn's output, and where the human left it when they had scrolled up to read
back. The transition from following live output to reading a finished turn SHALL NOT scroll the cell
on its own.

#### Scenario: Following at the bottom

- **WHEN** the human is at the bottom of a streaming cell and the turn finishes
- **THEN** the cell stays at the bottom of the finished transcript

#### Scenario: Scrolled up while reading back

- **WHEN** the human has scrolled up in a streaming cell and the turn finishes
- **THEN** the cell stays where the human left it, not jumped to the top or the bottom
