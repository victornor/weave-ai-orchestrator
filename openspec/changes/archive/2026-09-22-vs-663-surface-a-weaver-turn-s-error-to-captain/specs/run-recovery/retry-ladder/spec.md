## ADDED Requirements

### Requirement: A scheduled automatic retry is readable

When the system schedules an automatic retry after a failed turn, it SHALL record, on that run, the instant the attempt is due, and that instant SHALL be readable from the run so a surface can tell that a retry is in progress and when it is due. A failure that is not retried — a non-retryable failure, a usage limit, or an exhausted ladder — SHALL leave no scheduled instant on that run.

#### Scenario: A retryable failure records when the retry is due

- **WHEN** a turn fails with a retryable failure and an automatic attempt is scheduled
- **THEN** that run records the instant the retry is due, and the instant is readable from the run

#### Scenario: A failure that is not retried records no due instant

- **WHEN** a turn fails with a non-retryable failure, or with the retry ladder already spent
- **THEN** that run records no scheduled retry instant
