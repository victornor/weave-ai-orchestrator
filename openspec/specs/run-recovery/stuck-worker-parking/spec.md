# run-recovery/stuck-worker-parking Specification

## Purpose
Defines what happens to a worker whose automatic retries are spent, or whose failure is not
retryable at all: the work stops, and the choice of what to do next — retry, retry later, move to a
different runtime, or cancel — is put to the human as a decision on the worker's ticket, so that a
stuck worker is always visible and always answerable rather than silently paused.

## Requirements

### Requirement: Every decision kind the system defines can be persisted

The set of decision kinds the system can store SHALL be exactly the set of decision kinds the system
defines. Raising a decision of any defined kind SHALL store it and SHALL make it readable through the
same reads as every other decision, including the human's list of open decisions.

Widening the set of storable kinds SHALL preserve every decision already stored, together with the
constraints, uniqueness guarantees and referential integrity that applied to them before.

#### Scenario: A decision of every defined kind is stored

- **WHEN** a decision is raised for each kind the system defines, including `retry_approval`
- **THEN** each one is stored and can be read back with the kind it was raised with

#### Scenario: Widening preserves the decisions already stored

- **WHEN** a system holding decisions of several kinds, answered and open, is upgraded to a version
  that stores a wider set of kinds
- **THEN** every stored decision is still present, unchanged, with its answer, its status, its
  correlation key and its link to the ticket it concerns
- **AND** referential integrity across the stored data is intact

#### Scenario: A kind the system does not define is refused

- **WHEN** a decision is raised with a kind the system does not define
- **THEN** it is not stored

### Requirement: The card is withdrawn when the worker recovers

When a worker completes a turn successfully while a parking decision raised for it is still open, the
system SHALL withdraw that decision, so the human is not asked about a worker that is no longer stuck.

#### Scenario: The worker recovers on its own

- **WHEN** a worker whose parking decision is still open finishes a turn successfully
- **THEN** that decision is withdrawn and no longer appears in the human's open decisions

### Requirement: A failure to park a worker is loud and does not abandon the remaining steps

Parking a worker SHALL NOT fail silently. When any step of it fails, the system SHALL record the
failure at error severity, naming the run, the worker, the step that failed and the reason.

A failure in one step of parking SHALL NOT prevent the remaining steps from being attempted. In
particular, a failure to raise the decision SHALL NOT prevent the ticket from being moved to
`blocked`, and SHALL NOT prevent a booked retry from being scheduled.

#### Scenario: Raising the decision fails

- **WHEN** parking a worker and the decision cannot be raised
- **THEN** the failure is recorded at error severity, identifying the run and the worker
- **AND** the ticket is still moved to `blocked` and any booked retry is still scheduled

#### Scenario: Nothing fails

- **WHEN** parking a worker succeeds
- **THEN** no error is recorded

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

The decision SHALL offer retrying now and cancelling the ticket, and SHALL recommend one of them.
When a reset time is known it SHALL additionally offer retrying automatically at that reset time;
otherwise it SHALL offer retrying later. It SHALL NOT offer running the worker on another runtime,
because the runtime is a setting of the workspace and not of a worker; where the failure was a usage
limit the decision SHALL say which setting holds the runtime, so that the human can change it and
then retry. The system SHALL NOT start any attempt the human has not chosen: until the decision is
answered the worker stays parked and nothing further is spent on it.

The worker SHALL be paused with a reason that names the failure, and the ticket SHALL be moved to
`blocked` unless it has already reached a state in which no further work is expected.

The system SHALL raise at most one such open decision per worker: a second failure while one is
still open SHALL supersede it rather than adding a second card.

This requirement governs what happens once the system will not retry on its own. It does not change
how many automatic attempts there are, how long they wait, or which failures are retried.

#### Scenario: The retries are spent

- **WHEN** a worker's last automatic retry fails
- **THEN** a decision owned by the human is raised on that worker's ticket, offering retry, retry
  later, and cancel, and no option naming another runtime
- **AND** the decision appears in the human's list of open decisions
- **AND** the worker is paused and the ticket is `blocked`

#### Scenario: A usage limit parks on the first failure

- **WHEN** a worker's turn fails because its runtime reported a usage limit
- **THEN** the worker is parked on that first failure with no automatic attempt having been made
- **AND** the decision names the quota family and the runtime's message
- **AND** the decision says that the runtime is the workspace's workers setting

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
