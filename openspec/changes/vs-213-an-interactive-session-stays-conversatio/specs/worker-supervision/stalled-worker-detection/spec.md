## ADDED Requirements

### Requirement: An interactive session is never flagged as stalled

The system SHALL NOT detect a worker as stalled when its ticket is an interactive session. A
finished conversation on an open interactive ticket is complete success, not a worker that cannot
make further progress. The existing idle-session end remains the way a silent session is closed.

#### Scenario: An interactive session past the stall threshold is not flagged

- **WHEN** a worker's ticket is an interactive session, its most recent run finished longer ago than
  the stall threshold, and every other stalled-worker condition also holds
- **THEN** the worker is not detected as stalled and no `worker.stalled` event is raised for it
