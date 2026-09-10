# worker-supervision/stalled-worker-detection Specification

## Purpose
Defines a stalled worker — an agent with an unfinished ticket that nothing will ever wake again —
independent of run liveness, so the supervisor's periodic sweep can surface it even when no run is
hung or currently executing.

## Requirements

### Requirement: A worker with no possible source of a future wake is detected as stalled

The system SHALL periodically identify every worker agent that meets all of the following at once:

- the agent's status is not `retired`,
- the agent's ticket status is not a terminal status,
- the ticket has no decision in `open` status,
- the agent has no wakeup in `queued` or `claimed` status,
- the agent has no run in `queued` or `running` status,
- the agent's `last_run_at` is older than a fixed threshold.

An agent matching all of the above cannot make further progress on its own: nothing in the system
will ever wake it. The system SHALL raise this condition through the same fault-surfacing pattern
used for a stuck live run (a `worker.stalled` event, visible to the conductor through its digest),
and SHALL NOT enqueue a wakeup, retry, restart, or otherwise resume the agent's turn as a result of
detecting it.

#### Scenario: A worker whose last turn ended cleanly with nothing left to wake it is flagged

- **WHEN** a worker's most recent run finished with status `succeeded`, no wakeup was ever queued for
  it afterward, its ticket is still open, and the time since its last run exceeds the threshold
- **THEN** the worker is detected as stalled and a `worker.stalled` event is raised for it

#### Scenario: Detection never resumes the worker itself

- **WHEN** a worker is detected as stalled
- **THEN** no wakeup, retry, or restart is enqueued for it as a result of that detection alone

### Requirement: A worker that could still make progress on its own is never flagged

The system SHALL NOT flag a worker as stalled while any of the conditions above does not hold: a run
is queued or in progress for it, a decision on its ticket is still open, a wakeup is already queued or
claimed for it, or its ticket has reached a terminal status.

#### Scenario: A worker mid-run is not flagged

- **WHEN** a worker has a run in `running` status, however long ago its previous run finished
- **THEN** the worker is not detected as stalled

#### Scenario: A worker with an open decision is not flagged

- **WHEN** a worker's ticket has a decision in `open` status awaiting an answer, and the worker's
  `last_run_at` is older than the threshold
- **THEN** the worker is not detected as stalled

#### Scenario: A worker with a wakeup already queued is not flagged

- **WHEN** a worker has a wakeup in `queued` or `claimed` status, and its `last_run_at` is older than
  the threshold
- **THEN** the worker is not detected as stalled

#### Scenario: A worker on a terminal ticket is not flagged

- **WHEN** a worker's ticket status is a terminal status (`done` or `cancelled`)
- **THEN** the worker is not detected as stalled, whatever its `last_run_at`

### Requirement: The threshold is comfortably longer than an ordinary gap between turns

The stall threshold SHALL be a fixed, workspace-configurable duration chosen to be long enough that no
healthy worker waiting for its next ordinary turn is ever flagged, and short enough that a genuine
stall is detected well before it would otherwise go unnoticed for tens of minutes.

#### Scenario: A worker just past the end of a turn is not flagged

- **WHEN** a worker's last run finished less than the threshold ago, and every other stalled-worker
  condition also holds
- **THEN** the worker is not detected as stalled
