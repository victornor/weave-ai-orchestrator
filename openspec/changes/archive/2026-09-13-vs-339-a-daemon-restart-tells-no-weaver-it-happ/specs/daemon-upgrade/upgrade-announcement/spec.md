## ADDED Requirements

### Requirement: The announcement's run counts are what the restart actually recorded

The announcement's count of interrupted turns SHALL be read from the records the restart left — the turns the shutdown recorded as interrupted — and its count of resumed work SHALL be how many of those turns' wakes were left queued to start again. Neither SHALL be taken from a snapshot of what was running before the restart, so the two agree with what finalize and boot recovery actually did.

A turn that was still running when the wait for idle expired but finished before the restart SHALL NOT be counted as interrupted. A wake queued for a reason other than resuming an interrupted turn SHALL NOT be counted as resumed.

#### Scenario: The counts match the recorded interruptions

- **WHEN** an upgrade comes back and its restart recorded some turns interrupted and queued their wakes to resume
- **THEN** the announcement's interrupted count is the number of those recorded turns and its resumed count is the number of their queued wakes, not the number that were still executing when the wait for idle expired

#### Scenario: A turn that finished before the restart is not interrupted

- **WHEN** a turn was still running when the wait for idle expired but finished before the restart
- **THEN** the announcement does not count it as interrupted

#### Scenario: Unrelated queued work is not counted as resumed

- **WHEN** a wake was already queued for a reason other than resuming a turn the restart interrupted
- **THEN** the announcement's resumed count does not include it
