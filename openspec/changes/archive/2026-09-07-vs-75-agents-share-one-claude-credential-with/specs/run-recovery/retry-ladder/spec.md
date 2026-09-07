## MODIFIED Requirements

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
