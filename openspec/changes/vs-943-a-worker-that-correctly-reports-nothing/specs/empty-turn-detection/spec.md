## Purpose

Defines when the run engine fails a worker turn as `empty_turn`, so a worker that did report is never
paused or moved off its ticket's status by the detector, and a rejected report is never silent.

## ADDED Requirements

### Requirement: A report that fails validation is recorded, not erased

When a worker turn's final payload is report-shaped (carries a valid `state`) but fails `RunReportSchema`, the engine SHALL record a `run.report.invalid` run event listing the schema issues.

#### Scenario: Knowledge reason missing

- **WHEN** a turn's structured output has a valid `state` and `knowledge: {recorded: false}` with no `reason`
- **THEN** a `run.report.invalid` event is recorded naming `knowledge.reason`

### Requirement: A turn that filed a report-shaped payload is not empty

A worker turn SHALL NOT be failed as `empty_turn` when it produced a report-shaped payload, whether or not it validated. Such a run SHALL be `succeeded`, the worker SHALL NOT be paused, and the ticket's status SHALL NOT change. A payload that failed validation leaves liveness `empty`, so repeated unusable reports still count toward the three-empty-turns gate.

#### Scenario: A queued worker files a report the schema rejects

- **WHEN** a worker on a `merging` ticket ends a turn with a report-shaped payload that fails validation and changes nothing on the ticket
- **THEN** the run is `succeeded` with no error code, the worker is not paused, the ticket stays `merging`, and the run's liveness is `empty`

#### Scenario: A genuinely inert turn still fails

- **WHEN** a worker on an `in_progress` ticket ends a turn with no report-shaped payload and no ticket evidence
- **THEN** the run fails as `empty_turn` and the worker is paused

### Requirement: The empty-turn message states what was observed

The `empty_turn` failure message SHALL say that no report-shaped payload was produced and nothing was left on the ticket. It SHALL NOT assert that the worker has no way to report.

#### Scenario: Message wording

- **WHEN** a run fails as `empty_turn`
- **THEN** its error message does not say the worker "may have no way to report"
