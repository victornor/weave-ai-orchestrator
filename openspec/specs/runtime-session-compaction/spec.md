# runtime-session-compaction Specification

## Purpose
Provides reliable, observable out-of-band session compaction without allowing an automatic policy failure to livelock the agent or hide the pending wake.

## Requirements

### Requirement: Automatic compaction is single-attempt per observed context

The automatic compaction policy SHALL permit at most one compaction attempt for each observed positive context size. After an attempt starts, that observation SHALL be consumed and no longer be eligible until a later turn records a fresh context size.

#### Scenario: Repeated dispatcher ticks after an attempt

- **WHEN** an active session reports a context size at or above its configured threshold and the dispatcher starts automatic compaction
- **AND** subsequent dispatcher ticks observe the same stored context size
- **THEN** the dispatcher SHALL call the compaction operation exactly once, regardless of whether the command succeeds or fails, and SHALL leave the wake queued only while the compaction is in flight

#### Scenario: A fresh turn creates a new observation

- **WHEN** a later turn records a new context size after the prior compaction attempt
- **AND** that new size is at or above the configured threshold
- **THEN** the automatic policy MAY start one new compaction attempt for that fresh observation

### Requirement: Failed automatic compaction releases the pending wake

When an out-of-band compaction fails, the system SHALL persist the failure message on the active session, clear the compaction-in-progress state, and emit the normal session-compaction failure notification. The failed observation SHALL not be retried by dispatcher ticks; any wake held by compaction SHALL become eligible for dispatch.

#### Scenario: Runtime reports a compaction failure

- **WHEN** an automatic compaction command returns a failure
- **THEN** the session SHALL retain the failure reason, SHALL no longer be marked compacting, and SHALL not start another automatic compaction until a later turn records fresh context usage

#### Scenario: A wake is held during a failed compaction

- **WHEN** a wake remains queued while the compaction is running and the compaction then fails
- **THEN** the dispatcher SHALL be able to claim and run that wake after the compaction mark clears, without a timer-triggered retry taking precedence

### Requirement: Compaction success and failure remain observable

Manual and automatic compaction SHALL use the same session state transitions and notifications. A successful result SHALL clear any prior compaction error; a failed result SHALL expose its reason to the session view and logs without being replaced by a generic success or exit-code-only result.

#### Scenario: Manual compaction succeeds

- **WHEN** a user starts manual compaction for a resumable active session and the runtime reports success
- **THEN** the session SHALL leave the compacting state and expose no compaction error

#### Scenario: Manual compaction fails

- **WHEN** a user starts manual compaction and the runtime reports a failure with a reason
- **THEN** the session SHALL leave the compacting state and expose that reason through the session state and failure notification

### Requirement: Claude compaction success requires boundary evidence

The Claude runtime SHALL report compaction success only when its command completes without timeout or CLI error and its captured output contains the runtime's explicit compaction-boundary event. A zero exit status alone SHALL not be treated as proof that compaction occurred. The existing boundary predicate SHALL remain strict when a no-boundary result is caused by a repeated attempt against an already-compacted session.

#### Scenario: Claude emits a compaction boundary

- **WHEN** the Claude compaction command exits successfully and stdout contains a valid compaction-boundary event
- **THEN** the runtime SHALL report a successful compaction

#### Scenario: Claude exits successfully without a boundary

- **WHEN** the Claude compaction command exits successfully but its captured output contains no compaction-boundary event
- **THEN** the runtime SHALL report a failed compaction with diagnostic detail indicating that the boundary was not observed
