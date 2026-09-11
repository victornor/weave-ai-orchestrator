## ADDED Requirements

### Requirement: An operational ticket awaiting action approval is never flagged as stalled

The system SHALL NOT detect a worker as stalled when its ticket is `operational` and that ticket
has an `action_approval` in `open` status. Waiting for the human to approve an action is a live
action path, not a worker that cannot make further progress. The existing open-decision exemption
already implies this; this requirement names the operational wait so it cannot be dropped when
stall conditions are edited.

#### Scenario: An operational worker past the stall threshold with an open action approval is not flagged

- **WHEN** a worker's ticket is `operational`, an `action_approval` on that ticket is `open`, the
  worker's most recent run finished longer ago than the stall threshold, and every other
  stalled-worker condition also holds
- **THEN** the worker is not detected as stalled and no `worker.stalled` event is raised for it
