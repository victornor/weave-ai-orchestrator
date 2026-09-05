## Purpose

Defines what the daemon guarantees about the follow-up work a ticket's merge schedules after the
merge itself has finished: that the work still runs, that a failure in it is contained and logged
rather than raised into the process, and that the pending work can be cancelled and drained on
demand, so shutdown and tests are deterministic instead of racing a detached timer.

## ADDED Requirements

### Requirement: A merge still schedules its follow-up work

Finishing a ticket's merge SHALL schedule the re-index of its project's specs shortly afterwards,
rather than perform it inside the merge. Scheduling SHALL NOT delay, block or fail the merge itself:
the ticket reaches its finished state and the merge result is returned regardless of what the
follow-up work later does. A ticket that belongs to no project SHALL schedule no re-index.

#### Scenario: The re-index runs after a merge

- **WHEN** a ticket of a project finishes its merge
- **THEN** the merge completes and the project's specs are re-indexed shortly afterwards

#### Scenario: A ticket without a project schedules nothing

- **WHEN** a ticket that belongs to no project finishes its merge
- **THEN** the merge completes and no re-index is scheduled

### Requirement: Follow-up work never raises out of the daemon

Follow-up work scheduled after a merge SHALL be best-effort. Any failure in it — including the spec
indexing being unavailable, failing on the project, or throwing before it produces a result — SHALL
be caught and logged, and SHALL NOT surface as an unhandled error or an unhandled rejection in the
process, SHALL NOT change the merged ticket's outcome, and SHALL NOT prevent other pending follow-up
work from running.

#### Scenario: Spec indexing is unavailable

- **WHEN** a ticket's merge schedules a re-index and the spec indexing is unavailable, so that
  reaching it fails immediately
- **THEN** the failure is logged, the process raises no unhandled error, and the ticket stays merged

#### Scenario: The re-index fails on the project

- **WHEN** a ticket's merge schedules a re-index and re-indexing the project fails
- **THEN** the failure is logged, the process raises no unhandled error, and the ticket stays merged

#### Scenario: One failure does not stop the next

- **WHEN** two merges each schedule follow-up work and the first one fails
- **THEN** the second one still runs

### Requirement: Pending follow-up work can be cancelled and drained

The ticket service SHALL expose a single operation that stops its pending follow-up work: work that
is scheduled but has not started SHALL be cancelled and SHALL NOT run afterwards, and work already
in flight SHALL be awaited to completion or failure before the operation resolves. The operation
SHALL resolve — never reject — however the awaited work ended, SHALL resolve immediately when
nothing is pending, and SHALL be safe to call more than once.

After it resolves, the service SHALL have no follow-up work outstanding, so a caller that then
disposes of the resources the work depends on cannot be raced by it.

#### Scenario: Scheduled work is cancelled

- **WHEN** a merge has scheduled follow-up work that has not yet started and the service is stopped
- **THEN** stopping resolves and the follow-up work never runs

#### Scenario: In-flight work is awaited

- **WHEN** follow-up work is already running and the service is stopped
- **THEN** stopping resolves only after that work has finished or failed

#### Scenario: Stopping is safe to repeat and safe when idle

- **WHEN** the service is stopped with nothing pending, or stopped a second time
- **THEN** each call resolves without error

### Requirement: Shutdown drains follow-up work before disposing the workspace

The daemon SHALL stop each workspace's pending ticket follow-up work as part of shutting that
workspace down, and SHALL do so before it closes the workspace's database, so that no follow-up work
can run against a closed database.

#### Scenario: A merge just before shutdown

- **WHEN** a ticket merge schedules follow-up work and the daemon shuts down immediately afterwards
- **THEN** the follow-up work has either completed or been cancelled before the workspace database is
  closed, and shutdown reports no error from it
