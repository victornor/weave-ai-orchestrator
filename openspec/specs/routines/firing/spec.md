# routines/firing Specification

## Purpose
Defines how a due routine becomes a conductor wake through the existing wake queue, how the next fire is armed, and what happens when the daemon was down or the previous fire is still running.

## Requirements

### Requirement: A due routine wakes the conductor through the existing wake queue

When a routine is `active` and its next due time is at or before now, the daemon SHALL enqueue one wake for the workspace's conductor using the existing wake funnel, with source `routine`, a reason naming the routine, and a payload that includes the routine's id and its current instruction. The daemon SHALL NOT introduce a second wake mechanism, SHALL NOT wake a worker for the fire itself, and SHALL NOT enqueue a wake for a paused or removed routine.

The definition is the source of truth at fire time: the payload's instruction SHALL be the instruction stored on the routine at the moment of enqueue, not a snapshot taken when the routine was created or last edited hours earlier.

#### Scenario: A due routine wakes the conductor

- **WHEN** an active routine's next due time is in the past and the conductor is idle
- **THEN** a `routine` wake is queued for the conductor
- **AND** that wake's payload carries the routine's id and current instruction

#### Scenario: No new wake mechanism

- **WHEN** a routine fires
- **THEN** the wake exists as a row in the existing wake queue with source `routine`
- **AND** no other queue is written

#### Scenario: A paused routine does not fire

- **WHEN** a routine is paused and its next due time is in the past
- **THEN** no `routine` wake is enqueued for it

#### Scenario: Fire uses the instruction as it stands now

- **WHEN** captain edits a routine's instruction after it was created and then the routine becomes due
- **THEN** the enqueued wake carries the edited instruction

### Requirement: The next fire is armed after each one

After a fire is enqueued, the daemon SHALL set the routine's next due time to the next scheduled instant that is strictly after now, so a daily routine stays daily without captain intervening. Completing, failing or interrupting the fire's conductor run SHALL NOT be required before that next due time is recorded — except that a second fire SHALL NOT be enqueued while the previous fire's run is still in flight (see overlap).

#### Scenario: A daily routine stays daily

- **WHEN** a daily 07:00 routine fires at 07:00
- **THEN** its next due time is 07:00 the following day in its timezone
- **AND** captain does not have to re-create or re-enable it

#### Scenario: An interval routine re-arms from now

- **WHEN** an every-60-minutes routine fires
- **THEN** its next due time is 60 minutes after the fire, not 60 minutes after an original creation timestamp

### Requirement: A missed fire runs once late and never catch-up fires

If the daemon was not running at the scheduled instant, the routine SHALL fire once when the daemon is next able to, rather than being skipped. It SHALL NOT enqueue one wake per missed occurrence. After that late fire, the next due time SHALL be the next scheduled instant strictly after now — so several missed days become one late fire, then the schedule resumes.

This SHALL be asserted by a test that advances a simulated clock across more than one scheduled instant while no fire runs, then runs the fire pass once.

#### Scenario: Daemon down across several daily slots

- **WHEN** a daily 07:00 routine was due on Monday 07:00 and the daemon is next able to fire on Wednesday 10:00
- **THEN** exactly one `routine` wake is enqueued
- **AND** after that fire the next due time is Thursday 07:00, not Tuesday 07:00 or Wednesday 07:00

#### Scenario: Simulated outage does not catch up

- **WHEN** a test freezes time so two or more scheduled instants have passed with no fire, then runs the fire pass
- **THEN** exactly one wake is enqueued
- **AND** a second fire pass before that wake's run ends enqueues none

### Requirement: Overlapping fires cannot stack

While a fire's conductor run is still in flight — queued or running — the daemon SHALL NOT enqueue another wake for the same routine. When that run reaches a terminal status, the next due time SHALL already be the next scheduled instant after the fire that started it; if that instant is still in the future, the routine waits. The overlapped slot is skipped, not delayed into a second stacked turn.

`skip_if_active` is the concurrency behaviour this capability implements. `always` (pile on) SHALL NOT be offered.

#### Scenario: A second due instant during an in-flight fire is not queued

- **WHEN** a routine's fire has a conductor run still running and its next due time arrives
- **THEN** no second `routine` wake is enqueued for it

#### Scenario: After the in-flight run ends, the schedule is the next future slot

- **WHEN** a fire's conductor run reaches a terminal status and the following scheduled instant is still in the future
- **THEN** the routine's next due time is that future instant
- **AND** no extra wake is enqueued at the moment the run ends

#### Scenario: An overlapped slot that has already passed is skipped, not fired late

- **WHEN** a fire's conductor run is still in flight through the next scheduled instant, then reaches a terminal status after that instant
- **THEN** no additional `routine` wake is enqueued at that moment
- **AND** the next due time is the next scheduled instant strictly after now
