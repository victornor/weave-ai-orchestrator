# workspace-setup/setup-jobs Specification

## Purpose
Defines the job: the durable record a long-running workspace-setup operation keeps while it runs, so
that adding a project — minutes of cloning, adopting OpenSpec and seeding knowledge — is observable
from any surface instead of being a silent blocking request. The contract is that the operation
always says which sub-step it is on, always keeps the last output it produced, and is readable again
after a reload or a daemon restart.

## Requirements

### Requirement: A job is a durable record of one long-running operation

A long-running workspace-setup operation SHALL be represented by a job: a durable, workspace-scoped
record identifying its kind, the entity it acts on, who requested it, when it started, and its state.
A job SHALL be in exactly one of the states `running`, `done` or `failed`, and SHALL move only from
`running` to a terminal state. Every job SHALL record when it started and, once terminal, when it
finished. A failed job SHALL record which sub-step failed and a human-readable message.

The record SHALL survive a restart of the daemon, so a surface that reconnects after a restart still
sees what the operation was doing and how it ended.

The only kind of job defined by this capability is `project_add`.

#### Scenario: Starting an operation creates a job

- **WHEN** a long-running setup operation is started
- **THEN** a job exists in the `running` state, identifying its kind, the entity it acts on and its start time

#### Scenario: A failed job says what failed

- **WHEN** a job reaches the `failed` state
- **THEN** the record names the sub-step that failed and carries a human-readable message

#### Scenario: The record outlives the process that created it

- **WHEN** the daemon is restarted after a job finished
- **THEN** the job, its sub-steps and its log tail are still readable from the daemon that comes back

### Requirement: A job is an ordered list of sub-steps with their own timings

A job SHALL carry an ordered list of sub-steps, fixed for its kind and known in full from the moment
the job is created, so a surface can show the whole sequence before any of it has run. Each sub-step
SHALL carry a stable id, a human-readable label, and a state of `pending`, `running`, `done`,
`skipped` or `failed`. A sub-step that has started SHALL record when it started, and one that has
ended SHALL record when it ended.

At most one sub-step SHALL be `running` at a time. When a sub-step fails, the job SHALL fail and the
sub-steps after it SHALL remain `pending`.

A `project_add` job SHALL have exactly these sub-steps, in this order: clone the repository, resolve
the default branch, declare the project in the workspace configuration, adopt OpenSpec, seed the
project knowledge base, and create the scout ticket that describes the project. A sub-step whose work
is not applicable — OpenSpec adoption for a project with OpenSpec disabled, or for a repository that
already has it — SHALL end as `skipped` rather than `done`.

#### Scenario: The sequence is known before it runs

- **WHEN** a job has just been created and no sub-step has started
- **THEN** every sub-step of its kind is listed in order, each `pending` with its label

#### Scenario: Elapsed time is retained

- **WHEN** a sub-step has ended
- **THEN** the record still carries both its start and its end time

#### Scenario: A sub-step that does not apply is skipped

- **WHEN** a project with OpenSpec disabled is added
- **THEN** the OpenSpec sub-step ends as `skipped` and the job still reaches `done`

#### Scenario: A failing sub-step stops the job

- **WHEN** the clone sub-step fails
- **THEN** that sub-step is `failed`, the job is `failed`, and the later sub-steps are still `pending`

### Requirement: A job records the output of the commands it runs

While a job runs, the output of the commands it runs SHALL be captured line by line and attributed to
the sub-step that produced it, rather than being withheld until the command exits. Each captured line
SHALL carry a monotonically increasing sequence number within the job, the sub-step it belongs to, and
its text.

The job record SHALL retain a bounded tail of the most recent lines, so a completed or failed job
remains diagnosable without the record growing without limit. Lines beyond the tail MAY be dropped
from the record.

Captured output SHALL NOT be written to the workspace event outbox: the outbox SHALL carry only the
job's start and its finish.

#### Scenario: Output appears while the command is still running

- **WHEN** a command inside a sub-step has produced output but has not exited
- **THEN** those lines are already readable on the job, attributed to that sub-step

#### Scenario: The tail is bounded

- **WHEN** a job produces more lines than the retained tail holds
- **THEN** the record keeps the most recent lines and the job still reports its state and sub-steps

#### Scenario: The outbox is not flooded

- **WHEN** a job produces many output lines
- **THEN** the workspace event outbox gains one event for the job starting and one for it finishing, and none per line

### Requirement: A job can be read and streamed

A job SHALL be readable on demand, returning its state, its sub-steps with their timings, and its
retained log tail. Jobs SHALL be listable filtered by kind and by the entity they act on, so a surface
that lost its client state can find the job still running for a project.

A job SHALL also be streamable: the stream SHALL first replay the job's sub-step states and retained
log lines, and then deliver each further sub-step transition, output line and the job's completion as
they happen. Each streamed item SHALL carry the job's sequence number so a client that reconnects
resumes after the last item it saw rather than replaying from the start.

A surface watching a job's stream SHALL be able to tell the stream's connection being down from
the job itself having stalled: the stream SHALL expose its connection state per
`live-streams/connection-state`, retrying indefinitely while the surface holds it open, so a
dropped connection during onboarding does not look like the setup step has failed.

#### Scenario: A surface attaches mid-job

- **WHEN** a client opens the stream of a job that is already running
- **THEN** it receives the sub-step states and retained lines so far, and then continues to receive new ones live

#### Scenario: A reconnect resumes

- **WHEN** a client re-opens the stream giving the last sequence number it saw
- **THEN** it receives only the items after that sequence number

#### Scenario: Finding the job again after losing client state

- **WHEN** jobs are listed for a project
- **THEN** the jobs for that project are returned, most recent first

#### Scenario: The job stream's connection drops mid-job

- **WHEN** the connection underlying a job stream is lost while the job is still running
- **THEN** the surface watching it can tell the stream is reconnecting rather than assuming the
  job itself has stopped, and the stream keeps retrying without the surface reloading

### Requirement: Adding a project answers immediately and reports through a job

The request that adds a project SHALL create the project record and its job, start the operation, and
answer immediately with the project — in its `cloning` state — and the id of the job that is
performing it. It SHALL NOT hold the response open until the operation finishes.

The outcome SHALL be observable only through the job and the project record: the project's status
becomes `ready` when the job reaches `done`, and `error` with its error text when the job fails.

The behaviour of the operation itself SHALL be otherwise unchanged: the same clone, the same default
branch detection, the same workspace declaration, the same OpenSpec adoption, the same knowledge seed
and the same scout ticket, in the same order.

#### Scenario: The caller is answered before the clone finishes

- **WHEN** a project is added
- **THEN** the response carries the project in its `cloning` state and a job id, without waiting for the clone

#### Scenario: The project row reflects the outcome

- **WHEN** the job of a project add reaches `done`
- **THEN** the project's status is `ready` and its default branch is the one detected in the clone

#### Scenario: A failure is on both records

- **WHEN** the job of a project add fails
- **THEN** the job names the failing sub-step and the project's status is `error` with its error text

### Requirement: A failed project add can be retried

A project left in `error` by a failed add SHALL be retryable. Retrying SHALL re-run the same sub-steps
against the same project, reusing whatever the failed attempt already completed on disk — in
particular an existing clone SHALL NOT be re-cloned — and SHALL answer immediately with the project
and the id of the new job.

Retrying a project that is not in `error` SHALL be rejected as a conflict, and SHALL NOT start a
second job for it. A project SHALL NOT have two jobs running at once.

#### Scenario: Retry after a failure

- **WHEN** a project whose add failed is retried
- **THEN** a new job starts for it and the response carries the project and the new job id

#### Scenario: Retry reuses the clone

- **WHEN** a project whose add failed after the clone succeeded is retried
- **THEN** the clone sub-step completes without cloning again

#### Scenario: Retrying a healthy project is refused

- **WHEN** a project that is `ready` is retried
- **THEN** the request is rejected as a conflict and no job is started

### Requirement: A job left running by a stopped daemon is settled at startup

On startup the daemon SHALL settle every job left in `running` by a previous process: each SHALL be
moved to `failed` with a message saying the daemon stopped while it was running, and the project it
was adding SHALL be left in a state its owner can retry.

#### Scenario: The daemon restarts mid-job

- **WHEN** the daemon starts and finds a job in the `running` state
- **THEN** that job is `failed` with a message naming the restart, and it is not resumed

### Requirement: The operation behind an immediate answer is contained

An operation that a request started and did not wait for SHALL be best-effort with respect to the
process running it. When it fails, the failure SHALL be recorded on the job and on the entity the job
acts on, and SHALL be logged, exactly as when the operation is awaited — and it SHALL NOT additionally
surface as an unhandled error or an unhandled rejection in the process, and SHALL NOT prevent another
operation from being started afterwards.

The blocking form of the same operation, which the caller does await, SHALL continue to raise the
failure to that caller.

#### Scenario: A detached add that fails raises nothing

- **WHEN** a project add that was answered immediately fails
- **THEN** the job is `failed` with its failing sub-step, the project is `error` with its error text,
  the failure is logged, and the process raises no unhandled error or rejection

#### Scenario: The awaited form still raises

- **WHEN** a project is added through the form that waits for the operation and it fails
- **THEN** the caller receives the failure, and the job and the project record it as they otherwise would

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
