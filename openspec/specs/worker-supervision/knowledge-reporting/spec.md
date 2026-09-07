# worker-supervision/knowledge-reporting Specification

## Purpose
Describes the final report's required knowledge field: the explicit answer every turn gives about
what durable knowledge the ticket produced and where, or a stated reason there was none, and what
happens when a report skips the question.

## Requirements

### Requirement: Every final report answers what durable knowledge it produced, or states there was none

The structured final report every turn produces SHALL carry an explicit knowledge decision: either
that durable knowledge was recorded and where, or that none was, and why. This SHALL apply to every
report, whatever the ticket's kind and whatever the turn's outcome.

#### Scenario: Knowledge was recorded

- **WHEN** a turn's final report states that durable knowledge was recorded
- **THEN** the report also names where it was recorded

#### Scenario: Nothing was recorded

- **WHEN** a turn's final report states that no durable knowledge was recorded
- **THEN** the report also states why there was none

### Requirement: "Nothing durable" is always a complete, unpenalised answer

A report stating that no durable knowledge was produced, with a reason, SHALL be treated as a
complete answer to the knowledge question, exactly as complete as a report that recorded something.
Nothing SHALL treat the absence of a recorded fact as worse than its presence.

#### Scenario: A ticket that learned nothing new

- **WHEN** a ticket's work produced no fact worth keeping beyond the ticket itself
- **THEN** the report stating so, with a reason, is a complete report

### Requirement: A report that omits the knowledge decision is treated as no report at all

A structured final report missing the knowledge decision, or stating that knowledge was recorded
without saying where, or that none was recorded without saying why, SHALL fail to parse as a valid
report. A run whose report fails to parse SHALL be recorded exactly as a run that produced no report
is recorded today — its liveness SHALL be `empty`, on the same terms as a report missing its state.

#### Scenario: The field is missing entirely

- **WHEN** a turn's final report has no knowledge decision at all
- **THEN** the report fails to parse and the run's liveness is `empty`

#### Scenario: Recorded with nowhere named

- **WHEN** a turn's final report states that knowledge was recorded but names no location
- **THEN** the report fails to parse and the run's liveness is `empty`

#### Scenario: Nothing recorded with no reason

- **WHEN** a turn's final report states that no knowledge was recorded but gives no reason
- **THEN** the report fails to parse and the run's liveness is `empty`

### Requirement: The stated answer is never graded on its content

The daemon SHALL NOT judge whether a stated reason for recording nothing is a good one, and SHALL
NOT favour a report that recorded something over one that did not. The requirement is that the
question was answered, never what the answer was.

#### Scenario: A terse reason

- **WHEN** a turn's final report gives a brief, generic reason for recording nothing
- **THEN** the report is accepted on the same terms as any other complete report
