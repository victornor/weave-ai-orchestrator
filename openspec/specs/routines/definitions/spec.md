# routines/definitions Specification

## Purpose
Lets captain store recurring alarms for a workspace — a named schedule, an instruction, and an enabled state — and see, add, pause, resume or remove them without inventing a second work queue.

## Requirements

### Requirement: A routine is a durable recurring definition

A workspace SHALL store routines as durable records. Each routine SHALL have a name, a schedule, an instruction, an action policy (`report` or `file_work`), an enabled state (`active` or `paused`), and the time it is next due. Creating a routine SHALL compute that next due time from the schedule and the current clock. A paused or removed routine SHALL NOT become due.

The instruction is the source of truth. An edit to the instruction or schedule SHALL take effect on the next fire. Pausing SHALL prevent the next fire; resuming SHALL compute a new next due time strictly after now. Removing a routine SHALL delete it; it SHALL NOT fire afterwards.

#### Scenario: Creating an active daily routine

- **WHEN** captain creates an active routine scheduled daily at 07:00 with an instruction
- **THEN** the routine is listed as active with that name, schedule and instruction
- **AND** its next due time is the next 07:00 of its timezone that is strictly after creation

#### Scenario: Pause prevents the next fire

- **WHEN** an active routine is paused before it is due
- **THEN** it remains listed as paused
- **AND** it does not become due while paused

#### Scenario: Resume arms a future occurrence

- **WHEN** a paused routine is resumed
- **THEN** it is active
- **AND** its next due time is the next scheduled instant strictly after the resume, not a time already in the past

#### Scenario: Remove deletes the routine

- **WHEN** a routine is removed
- **THEN** it is no longer listed
- **AND** it does not fire afterwards

#### Scenario: An edited instruction is what the next fire carries

- **WHEN** captain changes a routine's instruction before it is due
- **THEN** the stored instruction is the new text
- **AND** the next fire carries that new text, not the text it was created with

### Requirement: A schedule is a local daily time or a minimum interval

A routine's schedule SHALL be one of:

- **daily** at an hour and minute in a named IANA timezone
- **interval** every N minutes, N at least 15

A daily schedule SHALL fire at that wall-clock time in the named timezone, including across daylight-saving transitions (07:00 means 07:00 local, not a fixed UTC offset). The timezone SHALL default to the daemon host's timezone at create when the caller does not name one. An unknown timezone SHALL be rejected as `validation`. An interval shorter than 15 minutes SHALL be rejected as `validation`. Cron expressions and webhook triggers SHALL NOT be accepted in this capability.

#### Scenario: Daily at local 07:00

- **WHEN** a routine is created daily at 07:00 in `Europe/Copenhagen`
- **THEN** its next due time is the next 07:00 in `Europe/Copenhagen`, not 07:00 UTC

#### Scenario: Host timezone is the default

- **WHEN** a routine is created without a timezone
- **THEN** it is stored with the daemon host's IANA timezone

#### Scenario: Sub-15-minute intervals are refused

- **WHEN** a routine is created with an interval of 5 minutes
- **THEN** the request is rejected with `validation` and no routine is stored

#### Scenario: An unknown timezone is refused

- **WHEN** a routine is created with timezone `Not/AZone`
- **THEN** the request is rejected with `validation` and no routine is stored

### Requirement: Captain can list, add, pause, resume and remove routines

A session-authenticated client SHALL list this workspace's routines and SHALL create, pause, resume, edit and remove them over HTTP. The `conductor` CLI SHALL expose the same operations as `routine list|show|add|pause|resume|rm`. The conductor SHALL have MCP tools to list, create, update and remove routines; a worker SHALL NOT. The web Settings page SHALL offer a Scheduled tasks section in the workspace area that lists this workspace's routines, lets captain add one, and lets them pause, resume or remove each.

Empty list SHALL be a normal empty state, not an error.

#### Scenario: HTTP list is empty until one exists

- **WHEN** the workspace has no routines
- **THEN** listing them returns an empty list

#### Scenario: CLI pause matches HTTP pause

- **WHEN** captain pauses a routine with `conductor routine pause`
- **THEN** a subsequent HTTP list shows that routine as paused

#### Scenario: A worker cannot create a routine

- **WHEN** a worker calls the MCP tool that creates routines
- **THEN** the call is rejected
- **AND** no routine is stored

#### Scenario: Settings shows the workspace's routines

- **WHEN** captain opens Settings → Scheduled tasks in this workspace
- **THEN** they see this workspace's routines by name, schedule, enabled state and next due time
- **AND** they can add, pause, resume or remove a routine from that section
