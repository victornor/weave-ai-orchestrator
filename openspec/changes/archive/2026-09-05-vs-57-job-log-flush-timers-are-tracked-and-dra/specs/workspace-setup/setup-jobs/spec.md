## ADDED Requirements

### Requirement: A job's deferred log write is cancellable and drained before the process ends

The write that persists a job's log tail is deferred, so between writes the tail exists only in the
process. That deferred write SHALL be cancellable, and the process SHALL be able to drain it: on
request every tail still held only in memory SHALL be written and every pending write SHALL be
cancelled, after which no further write SHALL be scheduled. Draining SHALL be safe to request when
there is nothing pending and safe to request more than once, and SHALL NOT fail a job or change its
state — a job still `running` stays running and is settled at the next startup as it otherwise would
be.

A process that disposes of the storage the jobs are recorded in SHALL drain first.

A deferred write that fails — because the storage is already gone, or for any other reason — SHALL be
logged with the job it belonged to and SHALL NOT surface as an unhandled error or an unhandled
rejection in the process.

The cadence itself is unchanged: captured output still reaches a connected stream as it is produced,
the retained tail is still bounded, and a sub-step transition and the job's completion still make the
tail durable.

#### Scenario: The tail is written after the flush delay

- **WHEN** a running job has produced a line and the flush delay has passed
- **THEN** the job's record carries that line, and the job's stream carried it when it was produced

#### Scenario: Draining writes what is still only in memory

- **WHEN** a running job has produced a line and the process is drained before the flush delay passes
- **THEN** the job's record carries that line once the drain has completed

#### Scenario: Nothing is written after the drain

- **WHEN** the storage is disposed of after a drain
- **THEN** no deferred write runs against it, and a line produced after the drain still reaches the
  job's stream and its in-memory tail without scheduling one

#### Scenario: A failed deferred write is contained

- **WHEN** a deferred write runs against storage that has already been disposed of
- **THEN** the failure is logged with the job's id and the process raises no unhandled error
