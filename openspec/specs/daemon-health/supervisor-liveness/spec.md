# daemon-health/supervisor-liveness Specification

## Purpose
Keeps a workspace's supervisor tick running whatever a single step does. Wake emission, routine firing, liveness scans and digests all depend on that tick. If it does stop, a daemon running under a service manager restarts itself rather than staying up and inert.

## Requirements

### Requirement: A step that throws does not stop later ticks

Every step of the supervisor tick SHALL be isolated. An exception or rejection from one step SHALL be logged with the step's name, and SHALL NOT prevent the remaining steps of that tick from running. The tick SHALL finish, and the next tick SHALL run every step again, including the one that failed.

#### Scenario: The digest step throws once
- **WHEN** one tick's digest step throws
- **THEN** that tick still runs the steps after it, and the next tick runs the digest step again and enqueues the digest wake

### Requirement: A step that never settles does not wedge the tick

Each awaited step of the supervisor tick SHALL run under a per-step timeout (2 minutes). When a step has not settled by its timeout, the tick SHALL log an error naming the step and continue with the remaining steps, and the tick SHALL finish. While a timed-out step's promise is still pending, later ticks SHALL skip that step alone, so it never runs twice at once, and SHALL run every other step. When the pending promise settles, the step SHALL rejoin later ticks and the time it took SHALL be logged.

#### Scenario: A merge-queue pump that hangs forever
- **WHEN** the merge-queue pump returns a promise that never settles
- **THEN** that tick finishes after the step timeout, the next tick skips only the pump, and the digest, liveness and routine steps keep running on every tick

#### Scenario: The hung step settles later
- **WHEN** the pending pump promise finally resolves
- **THEN** the following tick runs the pump again

### Requirement: The supervisor records its own progress

The supervisor SHALL record when its last tick started and finished, and which steps are in flight past their timeout and since when. It SHALL expose them, together with its derived state, through a `health()` read. That read uses no wake, no event and no run.

#### Scenario: Health read during a hung step
- **WHEN** a step has been pending for 5 minutes
- **THEN** `health()` lists that step and its age under steps in flight, and shows a `lastTickFinishedAt` newer than the step's start

### Requirement: A stalled supervisor under systemd exits so the service manager restarts it

The daemon SHALL check every workspace's supervisor health once a minute, on a timer separate from the supervisor tick. When a workspace has been `stalled` continuously for `supervisor.stallExitSec` seconds (daemon.yaml, default 600; `0` disables) and the process runs under systemd (`INVOCATION_ID` is set), the daemon SHALL log a fatal line naming the workspace and the stall and begin its normal shutdown with a non-zero exit code. It SHALL force the exit after 30 s if the shutdown does not finish. Without systemd it SHALL only log the stall as an error, once per stall.

#### Scenario: Stalled under systemd
- **WHEN** a workspace has been `stalled` for 600 s and `INVOCATION_ID` is set
- **THEN** the daemon logs a fatal line and exits with a non-zero code

#### Scenario: Stalled without a service manager
- **WHEN** the same stall occurs with no `INVOCATION_ID`
- **THEN** the daemon logs an error and keeps running

#### Scenario: Idle is not stalled
- **WHEN** the workspace is `idle_waiting_on_human` for 24 h with ticks finishing every 15 s
- **THEN** the daemon does not exit
