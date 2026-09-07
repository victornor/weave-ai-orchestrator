## MODIFIED Requirements

### Requirement: A worker the system will not retry itself is put to the human

When a worker's run fails and the system will not attempt it again by itself — because the automatic
attempts are spent, because the failure is not retryable, or because the runtime reported a usage
limit, which is never retried automatically — the system SHALL stop and SHALL raise a decision owned
by the human, attached to the worker's ticket, naming the worker and what it failed on.

A failure to authenticate SHALL be the one exception: it is not a fact about this worker but about
the credential the whole runtime shares, so the system SHALL NOT park the worker for the human and
SHALL NOT raise this per-worker decision for it. Such a failure SHALL stop the runtime and be
handled once for the runtime instead.

The decision SHALL name the family of the failure and the runtime's own message. When the runtime
reported when the limit resets, the decision SHALL say so.

The decision SHALL offer retrying now, retrying on each of the other runtimes available to that
worker, and cancelling the ticket, and SHALL recommend one of them. When a reset time is known it
SHALL additionally offer retrying automatically at that reset time; otherwise it SHALL offer
retrying later. The system SHALL NOT start any attempt the human has not chosen: until the decision
is answered the worker stays parked and nothing further is spent on it.

The worker SHALL be paused with a reason that names the failure, and the ticket SHALL be moved to
`blocked` unless it has already reached a state in which no further work is expected.

The system SHALL raise at most one such open decision per worker: a second failure while one is
still open SHALL supersede it rather than adding a second card.

This requirement governs what happens once the system will not retry on its own. It does not change
how many automatic attempts there are, how long they wait, or which failures are retried.

#### Scenario: The retries are spent

- **WHEN** a worker's last automatic retry fails
- **THEN** a decision owned by the human is raised on that worker's ticket, offering retry, retry
  later, each alternative runtime, and cancel
- **AND** the decision appears in the human's list of open decisions
- **AND** the worker is paused and the ticket is `blocked`

#### Scenario: A usage limit parks on the first failure

- **WHEN** a worker's turn fails because its runtime reported a usage limit
- **THEN** the worker is parked on that first failure with no automatic attempt having been made
- **AND** the decision names the quota family and the runtime's message

#### Scenario: A known reset time is offered, not booked

- **WHEN** a worker is parked because its runtime reported a usage limit and said when it resets
- **THEN** the decision says when the limit resets and offers retrying automatically at that time
- **AND** no attempt is scheduled unless the human chooses that option

#### Scenario: An unanswered card spends nothing

- **WHEN** a parked worker's decision is left unanswered
- **THEN** no turn is started for that worker

#### Scenario: A second failure while the card is open

- **WHEN** a worker that already has an open parking decision fails again
- **THEN** the earlier decision is superseded and the human is left with exactly one open card for
  that worker

#### Scenario: An authentication failure does not park the worker

- **WHEN** a worker's turn fails because the runtime could not authenticate
- **THEN** no per-worker decision is raised for it and the worker's ticket is not blocked for it
- **AND** the runtime is stopped and one decision is raised for the runtime instead
