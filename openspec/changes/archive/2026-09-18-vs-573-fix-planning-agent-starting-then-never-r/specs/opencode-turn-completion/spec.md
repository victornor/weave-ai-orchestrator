## Purpose

Defines when an OpenCode runtime turn counts as finished. `opencode run --format json` has no terminal event and can exit 0 after a provider failure it swallowed, so the adapter must decide from the stream whether the model actually finished.

## ADDED Requirements

### Requirement: A turn that ends mid-work is a failed turn
The OpenCode adapter SHALL report a turn as failed with error code `incomplete_turn` and family `transient_upstream` when the process exits without error but the last `step_finish` reason is `tool-calls`, meaning the model requested further work and none followed. A turn whose last step ended with a terminal reason (such as `stop`), and a turn that emitted no `step_finish` at all, SHALL keep the existing outcome.

#### Scenario: Stream ends after a tool-calls step
- **WHEN** the stream's last `step_finish` has reason `tool-calls` and the process exits 0
- **THEN** the turn result carries error code `incomplete_turn` with family `transient_upstream`, so the run engine retries it with backoff

#### Scenario: Stream ends after a stop step
- **WHEN** the stream's last `step_finish` has reason `stop` and the process exits 0
- **THEN** the turn is successful and carries no error

#### Scenario: A logged provider error accompanies the truncation
- **WHEN** an incomplete turn has a provider error in opencode's log for the session
- **THEN** the provider error is recorded as an `error` event on the run and its message is kept on the run
