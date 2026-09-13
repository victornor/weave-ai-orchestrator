# agent-tools/self-scheduled-wake Specification

## Purpose
Lets a worker ask the daemon's wake queue to start its next turn later, so a check it wants to make
after a long-running job survives the end of the turn that requested it — where the runtime's own
in-process scheduling tools cannot.

## Requirements

### Requirement: A worker can schedule its own next wake

The system SHALL expose a worker-scoped tool that enqueues a wakeup for the calling worker's own
agent, due at a caller-chosen time, carrying the caller's stated reason. The caller SHALL give either
a delay from now or an absolute instant, together with a non-empty reason. The enqueued wakeup SHALL
have wake source `self_scheduled`, a status of `queued`, and its `notBefore` set to the chosen
instant, so it is not dispatched before that time. The tool SHALL be available to workers and SHALL
NOT be available to the weaver, whose scheduling is the routines service.

#### Scenario: A worker schedules a check twenty minutes out

- **WHEN** a worker calls the tool with a delay of twenty minutes and a reason
- **THEN** a wakeup is queued for that worker with source `self_scheduled`, status `queued`, the
  given reason, and `notBefore` approximately twenty minutes from the call

#### Scenario: An absolute time is accepted and normalised to a delay

- **WHEN** a worker calls the tool with an absolute instant instead of a delay
- **THEN** the queued wakeup's `notBefore` is that instant

#### Scenario: The weaver cannot call the tool

- **WHEN** the weaver calls the tool by name
- **THEN** the call fails as forbidden and no wakeup is enqueued

### Requirement: Delays are bounded and a second schedule replaces the first

The system SHALL reject a schedule whose effective delay is shorter than a fixed minimum or longer
than a fixed maximum, and SHALL reject a request that gives neither a delay nor an instant, or both,
or an instant already in the past. A worker SHALL have at most one pending self-wake: a new schedule
SHALL cancel the worker's outstanding queued self-wake before enqueuing its own, so exactly one
queued self-wake for that worker remains, at the newest requested time and reason. The schedule SHALL
carry a stable idempotency key derived from the worker, so a duplicate call in the same turn cannot
stack a second wake.

#### Scenario: A second schedule replaces the pending self-wake

- **WHEN** a worker schedules a wake twenty minutes out, then schedules another thirty minutes out
- **THEN** the worker has exactly one queued self-wake and its `notBefore` and reason are the second
  call's

#### Scenario: A delay below the minimum is rejected

- **WHEN** a worker requests a delay shorter than the configured minimum
- **THEN** the call fails as a validation error and no wakeup is enqueued

#### Scenario: A delay above the maximum is rejected

- **WHEN** a worker requests a delay longer than the configured maximum
- **THEN** the call fails as a validation error and no wakeup is enqueued

#### Scenario: Neither or both of delay and instant

- **WHEN** a worker supplies neither a delay nor an instant, or supplies both
- **THEN** the call fails as a validation error and no wakeup is enqueued

#### Scenario: An instant in the past is rejected

- **WHEN** a worker supplies an absolute instant that has already passed
- **THEN** the call fails as a validation error and no wakeup is enqueued

### Requirement: A worker cannot schedule a wake for any agent but itself

The tool SHALL take no agent reference and SHALL always enqueue the wakeup for the calling worker's
own agent. A call that supplies an agent reference SHALL NOT cause a wakeup to be enqueued for that
other agent.

#### Scenario: An agent reference in the input cannot redirect the wake

- **WHEN** a worker calls the tool with the id of another agent in the input
- **THEN** the queued self-wake belongs to the calling worker, and the named agent gains no wakeup

### Requirement: The dispatcher starts the turn once the scheduled time passes

The dispatcher SHALL NOT claim a queued self-wake before its `notBefore`, and SHALL claim it like any
other queued wake once that time has passed, starting a turn for the worker whose reason is the
caller's stated reason. The reason SHALL be readable by the woken worker through the ordinary wake
surface.

#### Scenario: A future self-wake is not dispatched early

- **WHEN** a worker's turn ends immediately after it schedules a wake twenty minutes out, and less
  than twenty minutes have passed
- **THEN** no run has started for that worker

#### Scenario: The dispatcher starts the turn once the time passes

- **WHEN** the scheduled time passes and the worker is idle
- **THEN** the dispatcher starts a run for that worker, and the claiming wakeup carries the stated
  reason

### Requirement: The worker instructions name the tool and warn off the runtime's scheduler

The worker's installed instructions SHALL name the scheduling tool as the way to check on something
later, and SHALL state that the runtime's own scheduling tools do not survive the end of the turn and
must not be relied on.

#### Scenario: A worker reads its instructions before scheduling anything

- **WHEN** the worker instructions are rendered
- **THEN** they name the scheduling tool and warn that the runtime's scheduling tools die with the
  turn

### Requirement: Worker turns deny the runtime's own scheduler tools

Where a runtime adapter exposes a clean mechanism to deny named tools, a worker's turn SHALL deny that
runtime's own scheduling tools, so a worker cannot fall back on a timer that cannot fire. The denial
SHALL NOT apply to the weaver. An adapter that offers no such mechanism SHALL be unaffected, and the
denial SHALL be data declared by the adapter rather than a runtime id hardcoded in the run engine.

#### Scenario: A worker's turn denies the runtime's scheduler tools

- **WHEN** a turn is launched for a worker on a runtime that declares its scheduler tools
- **THEN** the turn is spawned with those tools denied

#### Scenario: A weaver's turn is not denied them

- **WHEN** a turn is launched for the weaver on the same runtime
- **THEN** the scheduler-tool denial is not added

### Requirement: A pending self-wake is visible wherever a worker's status is shown

While a worker has a queued self-wake, the system SHALL surface its scheduled time and its reason
wherever that worker's status is shown to the operator: the worker list and get tools, run
inspection's worker view, the worker HTTP routes, and the web worker card. Once the wake has been
claimed, cancelled or replaced, it SHALL no longer be shown.

#### Scenario: The pending self-wake appears on the worker's status views

- **WHEN** a worker has a queued self-wake at a known time and for a known reason
- **THEN** the worker list row, the worker detail, and the inspected worker each report that time and
  reason

#### Scenario: A consumed self-wake is no longer shown

- **WHEN** the scheduled wake has been claimed for a new run, or replaced by a later schedule
- **THEN** the worker's status views no longer report the old time and reason
