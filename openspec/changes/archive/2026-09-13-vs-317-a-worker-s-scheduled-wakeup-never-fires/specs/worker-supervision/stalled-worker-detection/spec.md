## MODIFIED Requirements

### Requirement: A worker with no possible source of a future wake is detected as stalled

The system SHALL periodically identify every worker agent that meets all of the following at once:

- the agent's status is not `retired`,
- the agent's ticket status is not a terminal status,
- the ticket has no decision in `open` status,
- the agent has no wakeup that is an action path: a wakeup in `claimed` status; a wakeup in `queued`
  status whose source is not `self_scheduled`; or a `self_scheduled` wakeup whose scheduled time has
  not yet passed by more than a fixed grace margin,
- the agent has no run in `queued` or `running` status,
- the agent's `last_run_at` is older than a fixed threshold.

A queued self-wake is a real action path while it is due or imminent, so a worker waiting on one is
making progress on its own. Once its scheduled time has passed by more than the grace margin — long
enough that the dispatcher would have claimed it — it no longer counts, and the worker is treated as
having no source of a future wake. An agent matching all of the above cannot make further progress on
its own: nothing in the system will ever wake it. The system SHALL raise this condition through the
same fault-surfacing pattern used for a stuck live run (a `worker.stalled` event, visible to the
conductor through its digest), and SHALL NOT enqueue a wakeup, retry, restart, or otherwise resume
the agent's turn as a result of detecting it.

#### Scenario: A worker whose last turn ended cleanly with nothing left to wake it is flagged

- **WHEN** a worker's most recent run finished with status `succeeded`, no wakeup was ever queued for
  it afterward, its ticket is still open, and the time since its last run exceeds the threshold
- **THEN** the worker is detected as stalled and a `worker.stalled` event is raised for it

#### Scenario: A worker idle well past its own scheduled self-wake is flagged

- **WHEN** a worker's only queued wakeup is a `self_scheduled` one whose scheduled time passed more
  than the grace margin ago, its ticket is still open, and the time since its last run exceeds the
  threshold
- **THEN** the worker is detected as stalled and a `worker.stalled` event is raised for it

#### Scenario: Detection never resumes the worker itself

- **WHEN** a worker is detected as stalled
- **THEN** no wakeup, retry, or restart is enqueued for it as a result of that detection alone

### Requirement: A worker that could still make progress on its own is never flagged

The system SHALL NOT flag a worker as stalled while any of the conditions above does not hold: a run
is queued or in progress for it, a decision on its ticket is still open, a wakeup that is an action
path is queued or claimed for it, or its ticket has reached a terminal status. A queued
`self_scheduled` wakeup is an action path while it is due or not yet past its scheduled time by more
than the grace margin, and is not one after that.

#### Scenario: A worker mid-run is not flagged

- **WHEN** a worker has a run in `running` status, however long ago its previous run finished
- **THEN** the worker is not detected as stalled

#### Scenario: A worker with an open decision is not flagged

- **WHEN** a worker's ticket has a decision in `open` status awaiting an answer, and the worker's
  `last_run_at` is older than the threshold
- **THEN** the worker is not detected as stalled

#### Scenario: A worker with a wakeup already queued is not flagged

- **WHEN** a worker has a queued or claimed wakeup whose source is not `self_scheduled`, and its
  `last_run_at` is older than the threshold
- **THEN** the worker is not detected as stalled

#### Scenario: A worker waiting on a pending self-wake is not flagged

- **WHEN** a worker has a queued `self_scheduled` wakeup whose scheduled time is in the future, and
  its `last_run_at` is older than the threshold
- **THEN** the worker is not detected as stalled

#### Scenario: A worker a moment past its self-wake is not flagged yet

- **WHEN** a worker has a queued `self_scheduled` wakeup whose scheduled time passed less than the
  grace margin ago
- **THEN** the worker is not detected as stalled

#### Scenario: A worker on a terminal ticket is not flagged

- **WHEN** a worker's ticket status is a terminal status (`done` or `cancelled`)
- **THEN** the worker is not detected as stalled, whatever its `last_run_at`
