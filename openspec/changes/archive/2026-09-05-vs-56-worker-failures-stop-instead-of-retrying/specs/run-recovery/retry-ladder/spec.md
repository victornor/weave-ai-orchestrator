## Purpose
Defines the automatic recovery the system attempts on its own when a worker's turn fails: which
failures it retries, how many times and how far apart, how the attempts on one piece of work are
linked so that the ladder can be counted, and which failures it refuses to retry at all.

## ADDED Requirements

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
then 2 minutes, then 10 minutes. An authentication failure SHALL be retried at most once, after the
credential has been refreshed.

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
