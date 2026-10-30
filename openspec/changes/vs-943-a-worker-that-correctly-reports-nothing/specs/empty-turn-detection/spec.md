## Purpose

Defines when the run engine fails a worker turn as `empty_turn`, so a worker that did report is never
paused or moved off its ticket's status by the detector.

## ADDED Requirements

### Requirement: A turn that filed a structured report is not empty

A worker turn SHALL NOT be failed as `empty_turn` when its run called the runtime's `StructuredOutput`
tool, whether or not the daemon could read the resulting report. Such a run SHALL be recorded
`succeeded`, the worker SHALL NOT be paused, and the ticket's status SHALL NOT change.

#### Scenario: A queued worker reports and waits

- **WHEN** a worker on a `merging` ticket ends a turn having called `StructuredOutput` and nothing else
- **THEN** the run is `succeeded` with no error code, the worker is not paused, and the ticket stays `merging`

#### Scenario: A genuinely inert turn still fails

- **WHEN** a worker on an `in_progress` ticket ends a turn with no readable report, no ticket evidence and no `StructuredOutput` call
- **THEN** the run fails as `empty_turn` and the worker is paused

### Requirement: The empty-turn message states what was observed

The `empty_turn` failure message SHALL say that no readable report was produced, that nothing was left on the ticket, and that `StructuredOutput` was never called. It SHALL NOT assert that the worker has no way to report.

#### Scenario: Message wording

- **WHEN** a run fails as `empty_turn`
- **THEN** its error message names the missing `StructuredOutput` call and does not say the worker "may have no way to report"
