# run-recovery/retry-ladder Specification

## Purpose
Defines the automatic recovery the system attempts on its own when a worker's turn fails: which
failures it retries, how many times and how far apart, how the attempts on one piece of work are
linked so that the ladder can be counted, and which failures it refuses to retry at all.

## Requirements

### Requirement: Attempts on the same work are linked

When a turn is started because an earlier turn failed, the system SHALL record, on the new attempt,
which attempt it is retrying. That link SHALL be recorded whoever asked for the retry — the failure
handling itself, the daemon's supervision of a silent, timed-out or interrupted turn, or a human.

A turn started for any other reason SHALL record no such link.

The chain of links SHALL be readable, so the number of automatic attempts already made on one piece
of work can be determined from what is stored rather than inferred.

#### Scenario: A retry records what it retries

- **WHEN** a turn is started from a retry of an earlier failed turn
- **THEN** the new turn records the identity of the turn it is retrying

#### Scenario: An ordinary turn records no link

- **WHEN** a turn is started for a new instruction, a message or a scheduled wake
- **THEN** it records no retry link

#### Scenario: The chain is countable

- **WHEN** three retries have followed one original failure
- **THEN** the number of attempts already made is readable from the recorded chain as three

### Requirement: The automatic ladder is bounded

A failure the system retries automatically SHALL be retried at most three times, waiting 30 seconds,
then 2 minutes, then 10 minutes.

An authentication failure SHALL NOT be retried automatically at all. It is not a transient fault of
one turn but a fact about the one credential the whole runtime shares, so retrying it can only fail
again and spend the attempt. Such a failure SHALL instead stop the runtime and be handled once for
the runtime rather than once per turn.

When the attempts are spent, the system SHALL stop retrying and SHALL park the worker for the human.
It SHALL NOT start a further automatic attempt on that work.

#### Scenario: The ladder ends

- **WHEN** a worker's turn fails with a retryable failure and three automatic attempts have already
  been made
- **THEN** no further automatic attempt is started
- **AND** the worker is parked for the human

#### Scenario: The waits are unchanged

- **WHEN** the first, second and third automatic attempts are scheduled after a retryable failure
- **THEN** they are scheduled 30 seconds, 2 minutes and 10 minutes after their failure respectively

#### Scenario: An authentication failure is not retried

- **WHEN** a worker's turn fails because the runtime could not authenticate
- **THEN** no automatic attempt is scheduled for it, at any point
- **AND** the runtime is stopped and handled once instead

### Requirement: A usage limit is never retried automatically

A failure the runtime reports as a provider quota or usage limit SHALL NOT enter the automatic
ladder. The system SHALL stop on the first such failure and park the worker for the human, spending
nothing further on that work until the human answers.

#### Scenario: The first quota failure stops the work

- **WHEN** a worker's turn fails because its runtime reported a usage limit
- **THEN** no automatic attempt is scheduled
- **AND** the worker is parked for the human on that first failure

#### Scenario: Nothing is spent while it waits

- **WHEN** a worker parked for a usage limit is left unanswered
- **THEN** no turn is started for it and no tokens are spent on it

### Requirement: A scheduled automatic retry is readable

When the system schedules an automatic retry after a failed turn, it SHALL record, on that run, the instant the attempt is due, and that instant SHALL be readable from the run so a surface can tell that a retry is in progress and when it is due. A failure that is not retried — a non-retryable failure, a usage limit, or an exhausted ladder — SHALL leave no scheduled instant on that run.

#### Scenario: A retryable failure records when the retry is due

- **WHEN** a turn fails with a retryable failure and an automatic attempt is scheduled
- **THEN** that run records the instant the retry is due, and the instant is readable from the run

#### Scenario: A failure that is not retried records no due instant

- **WHEN** a turn fails with a non-retryable failure, or with the retry ladder already spent
- **THEN** that run records no scheduled retry instant
