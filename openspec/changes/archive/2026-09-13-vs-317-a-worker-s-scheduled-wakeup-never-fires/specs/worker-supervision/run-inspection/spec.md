## ADDED Requirements

### Requirement: The inspection reports a pending self-wake on the inspected worker

The worker state reported by an inspection SHALL include the worker's pending self-wake when it has
one — the scheduled time and the reason the worker gave — so that a worker waiting on its own
schedule is not read as idle with nothing to wake it. A worker with no pending self-wake SHALL report
no scheduled wake.

#### Scenario: A worker waiting on its own scheduled wake

- **WHEN** the conductor inspects a worker that has a queued self-wake at a known time and for a
  known reason
- **THEN** the reported worker state includes that scheduled time and reason

#### Scenario: A worker with no scheduled wake

- **WHEN** the conductor inspects a worker that has no queued self-wake
- **THEN** the reported worker state carries no scheduled self-wake
