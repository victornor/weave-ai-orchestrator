## MODIFIED Requirements

### Requirement: Delays are bounded and a second schedule replaces the first

The system SHALL reject a schedule whose effective delay is shorter than a fixed minimum or longer
than a fixed maximum, and SHALL reject a request that gives neither a delay nor an instant, or both,
or an instant already in the past. A worker SHALL have at most one pending self-wake: a new schedule
SHALL supersede the worker's previous self-wake before enqueuing its own, so exactly one queued
self-wake for that worker remains, at the newest requested time and reason. A superseded self-wake
that is still pending SHALL be cancelled. The schedule SHALL carry a stable idempotency key derived
from the worker, so a duplicate call in the same turn cannot stack a second wake, and the replacement
SHALL succeed whatever status the worker's previous self-wake is in — pending, claimed, completed or
failed — with the previous row no longer holding that key, so the new schedule is never refused
because an earlier wake of the worker's own finished.

#### Scenario: A second schedule replaces the pending self-wake

- **WHEN** a worker schedules a wake twenty minutes out, then schedules another thirty minutes out
- **THEN** the worker has exactly one queued self-wake and its `notBefore` and reason are the second
  call's

#### Scenario: A second schedule supersedes one already claimed for the current turn

- **WHEN** a worker whose current turn was started from its own scheduled wake schedules another wake
  before that turn ends
- **THEN** the new self-wake is queued with the new time and reason, exactly one queued self-wake
  remains for the worker, and no error is raised

#### Scenario: A second schedule supersedes one already finished

- **WHEN** a worker whose previous self-wake has been completed or failed schedules another wake
- **THEN** the new self-wake is queued with the new time and reason, exactly one queued self-wake
  remains for the worker, and no error is raised

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
