## ADDED Requirements

### Requirement: Live cells put running workers before waiting ones

The Live page SHALL order its cells so that a worker with an in-progress run (running or queued,
the same `isActiveRun` rule the page uses to stream) comes before every live worker that is between
turns. Within each of those two groups the page SHALL keep its existing order: the newest worker
first. A cell SHALL change position only when its worker changes group.

A worker whose in-progress run ends SHALL stay in the running group for a short grace period
(about ten seconds) before moving below the waiting workers, so a turn that ends and a next turn
that starts moments later does not bounce the cell to the bottom and back. An in-progress run that
starts within that window SHALL keep the cell in the running group without it moving.

Reordering SHALL NOT change which cells hold a run-tail `EventSource` slot, SHALL NOT cause a cell
to drop or reopen its run-event stream, and SHALL NOT change a cell's saved size: a cell that moves
keeps the size the human gave it.

#### Scenario: A running worker sits above a waiting worker

- **WHEN** a live worker with an in-progress run and a newer live worker between turns both have
  cells on the Live page
- **THEN** the running worker's cell appears before the waiting worker's cell

#### Scenario: Order within a group is newest first

- **WHEN** two workers with in-progress runs and two workers between turns are live, each pair with
  different spawn times
- **THEN** each pair is ordered newest worker first, and every running worker is above every waiting
  worker

#### Scenario: A just-finished cell holds its place

- **WHEN** a cell's in-progress run ends and its worker is now between turns
- **THEN** the cell stays in the running group, in its current position, for the grace period

#### Scenario: A next turn inside the window keeps the cell in place

- **WHEN** a cell's run ends and the worker starts a new in-progress run within the grace period
- **THEN** the cell stays in the running group and does not move

#### Scenario: The cell moves down after the grace period

- **WHEN** a cell's run has ended and the worker has no new in-progress run once the grace period
  has elapsed
- **THEN** the cell moves below the running workers and among the waiting workers by its existing
  order

#### Scenario: Reordering leaves the stream slots alone

- **WHEN** the running and waiting groups change and cells are reordered
- **THEN** the set of cells holding a run-tail `EventSource` slot is the same as it would be under
  the page's existing order, and a cell that moves neither drops nor reopens its run-event stream

#### Scenario: A moved cell keeps its saved size

- **WHEN** the human has resized a cell and its worker later changes group and moves
- **THEN** that cell keeps the size the human gave it
