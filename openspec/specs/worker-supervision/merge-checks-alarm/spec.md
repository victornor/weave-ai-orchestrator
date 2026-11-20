# worker-supervision/merge-checks-alarm Specification

## Purpose
The merge-slot stall alert (`mergeChecksAlarmSec`, default 20 min) fires whenever a slot holder's checks
are unresolved for that long. FanStack's `dotnet-tests` job legitimately takes 25–37 min, so on
2026-11-20 the alert fired on four healthy landings (VS-981, VS-983 twice, VS-985), each time reading
"6/7 passed" as if something were wrong. The alert text also invited a re-run of a job 25 minutes into
a 30-minute suite. On VS-981 the alert was answered by moving the ticket out of `merging` into
`blocked`, which clears `merge_queued_at`/`merge_started_at`: the worker was stranded out of the queue
until a human put it back. An alert that always fires carries no information, and waiting resolves
itself where losing the queue place does not.
## Requirements

### Requirement: The merge-checks alarm distinguishes slow from stuck

The system SHALL raise the merge-slot checks alarm for a non-draft slot holder only when its pending
checks are evidence of a stall, judged per check from the forge rollup: a check that is running SHALL
count as stuck only after it has run for longer than GitHub's job limit (360 minutes); a check that is
queued or has no recorded start SHALL count as stuck once it has waited `mergeChecksAlarmSec`; when no
check is pending by name (no run, or all skipped or cancelled) the slot's age against
`mergeChecksAlarmSec` SHALL decide. The alarm SHALL repeat at the `mergeChecksAlarmSec` cadence while stuck.

#### Scenario: A long job that is running is not alarmed

- **WHEN** a slot holder has been admitted 37 minutes, six of seven checks passed and the seventh is `IN_PROGRESS` since admission
- **THEN** no alarm is raised and the ticket stays `merging`

#### Scenario: A check that never started is alarmed

- **WHEN** a check is `QUEUED` for longer than `mergeChecksAlarmSec`
- **THEN** the weaver is woken once, naming the check as not started

#### Scenario: A job past GitHub's limit is alarmed

- **WHEN** a check has been `IN_PROGRESS` for more than 360 minutes
- **THEN** the weaver is woken, naming the check as running longer than GitHub's own job limit

### Requirement: The alarm never changes the ticket

The alarm SHALL only comment on the ticket and wake the weaver. It SHALL NOT change the ticket's status,
`merge_queued_at` or `merge_started_at`, and its text SHALL NOT call a run hung or invite re-running it; it SHALL state that the queue place is kept.

#### Scenario: Alarming keeps the queue place

- **WHEN** the alarm fires for a `merging` ticket with queue timestamps set
- **THEN** the ticket is still `merging` with the same `merge_queued_at` and `merge_started_at`
