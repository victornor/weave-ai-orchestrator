## Purpose

Defines what happens to a worker whose automatic retries are spent, or whose failure is not
retryable at all: the work stops, and the choice of what to do next — retry, retry later, move to a
different runtime, or cancel — is put to the human as a decision on the worker's ticket, so that a
stuck worker is always visible and always answerable rather than silently paused.

## ADDED Requirements

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

### Requirement: A worker whose automatic retries are spent is put to the human

When a worker's run fails, its automatic retries are spent, and the failure is not one the system
handles on its own, the system SHALL stop retrying and SHALL raise a decision owned by the human,
attached to the worker's ticket, naming the worker and what it failed on. The decision SHALL offer
retrying now, retrying later, retrying on each of the other runtimes available to that worker, and
cancelling the ticket, and SHALL recommend one of them.

The worker SHALL be paused with a reason that names the failure, and the ticket SHALL be moved to
`blocked` unless it has already reached a state in which no further work is expected.

The system SHALL raise at most one such open decision per worker: a second failure while one is still
open SHALL supersede it rather than adding a second card.

This requirement governs only what happens once the retries are spent. It does not change how many
automatic retries there are, how long they wait, or which failures are retried.

#### Scenario: The retries are spent

- **WHEN** a worker's last automatic retry fails
- **THEN** a decision owned by the human is raised on that worker's ticket, offering retry, retry
  later, each alternative runtime, and cancel
- **AND** the decision appears in the human's list of open decisions
- **AND** the worker is paused and the ticket is `blocked`

#### Scenario: A usage limit books one more attempt

- **WHEN** a worker is parked because its runtime reported a usage limit
- **THEN** the decision says when the next automatic attempt is booked, and that attempt is scheduled
  for the limit's reset time when the runtime reported one

#### Scenario: A second failure while the card is open

- **WHEN** a worker that already has an open parking decision fails again
- **THEN** the earlier decision is superseded and the human is left with exactly one open card for
  that worker

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
