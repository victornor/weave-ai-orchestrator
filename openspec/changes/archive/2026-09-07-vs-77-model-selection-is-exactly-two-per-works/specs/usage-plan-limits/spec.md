## MODIFIED Requirements

### Requirement: The daemon keeps one current account snapshot per runtime

The system SHALL store, per workspace and runtime, the most recent account description together with
the time it was captured. A new snapshot SHALL replace the previous one for that workspace and
runtime; the system does not keep snapshot history.

The system SHALL refresh the snapshots on a recurring daemon poll without any user action, for every
runtime the workspace is spending on: the runtimes named by its two model settings, together with
the runtime of any agent that has not yet been retired, so that a worker still finishing a turn on a
runtime a setting has since moved away from is still accounted for. A refresh SHALL NOT block a run,
and a refresh that fails SHALL leave the previous snapshot in place and record the reason.

#### Scenario: The poll refreshes a snapshot

- **WHEN** the refresh interval has elapsed and a workspace has an agent configured on a runtime
- **THEN** that runtime's account is described again and the stored snapshot is replaced, with the
  capture time set to the moment it was captured

#### Scenario: A runtime nothing uses is not polled

- **WHEN** the refresh runs and a runtime is named by neither of the workspace's model settings and
  by no agent that is still live
- **THEN** that runtime is not described and no snapshot is written for it

#### Scenario: A refresh fails

- **WHEN** describing an account throws or times out during a refresh
- **THEN** the previously stored snapshot is left unchanged and the failure is logged, not surfaced
  as a daemon error
