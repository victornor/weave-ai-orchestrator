# runtime-launch/worker-memory-containment Specification

## Purpose
Keeps one worker's memory use from becoming the daemon's — and every other worker's — problem by giving each worker turn its own memory-limited control group, so an out-of-memory kill takes that worker's process tree alone.

## Requirements

### Requirement: A worker turn runs in its own memory-limited control group

Where a systemd user manager is available, every worker runtime process tree SHALL run inside its own transient systemd scope, separate from the daemon's own unit. The scope SHALL be named after the run so it is identifiable in `systemctl --user list-units`, and SHALL carry the resolved memory limit (see `runtime-launch/worker-memory-limits`).

The scope SHALL be created with `MemoryHigh` and `MemoryMax` both at the worker's limit, a swap ceiling that prevents a runaway worker from driving the host into swap, `ManagedOOMMemoryPressure=kill`, and `OOMPolicy=kill` so the kernel kills the whole worker process tree and not one process out of it. A worker that reaches its limit SHALL be ended, not merely throttled into an indefinite stall.

A worker's own descendants (its CLI, builds, tests, ffmpeg, browsers) SHALL be in that scope; a daemon process SHALL NOT be.

#### Scenario: A worker runs a memory-hungry command
- **WHEN** a worker turn spawns a process tree that allocates past its limit
- **THEN** the kernel or `systemd-oomd` kills that worker's scope and the daemon process keeps running

#### Scenario: The scope's name identifies the run
- **WHEN** an operator lists the user manager's units while a turn is running
- **THEN** the running turn's scope is listed, named after that run

### Requirement: The daemon unit is not a kill candidate

The systemd unit template the daemon installs (and the legacy unit it corrects) SHALL set `ManagedOOMPreference=avoid` on the daemon's own unit, so `systemd-oomd` selects a worker scope in preference to the daemon even when both are candidates.

#### Scenario: A host that installed the service before this change
- **WHEN** the daemon next renders or corrects its installed unit on such a host
- **THEN** the unit carries `ManagedOOMPreference=avoid`

### Requirement: Containment is observable

The daemon SHALL record, for a worker turn, the transient scope it ran in and the peak memory that scope reached, so a memory kill can be attributed and reported.

#### Scenario: Reading a finished turn's containment
- **WHEN** a turn finishes
- **THEN** the run's record names the scope and the peak memory observed for it

### Requirement: No systemd user manager, no change, and a notice

Where no systemd user manager is reachable — macOS, a container, another init — the daemon SHALL spawn the worker exactly as it does today and SHALL log a single notice saying worker memory containment is unavailable on this host. It SHALL NOT fail the turn, degrade to a different command, or block starting.

#### Scenario: Running on a host without a user manager
- **WHEN** a worker turn is spawned on such a host
- **THEN** the turn runs as it did before this change and one notice is logged

### Requirement: Cancellation and orphan cleanup reach the scope, not only a pid

Stopping a turn for a human interrupt, a watchdog cut, or daemon restart SHALL stop the worker's scope so its whole process tree ends, rather than signalling a process id or group that may no longer name it.

#### Scenario: The watchdog cuts a runaway turn
- **WHEN** the supervisor cuts a turn that is running in a scope
- **THEN** the scope is stopped and no process of that worker survives

#### Scenario: The daemon restarts with a turn still running
- **WHEN** the daemon starts and finds a run left `running` by a previous daemon
- **THEN** the run's scope is stopped before the run is recovered

### Requirement: The containment wrapper gets the user-bus environment; the contained command does not

When a spawn is wrapped in a `systemd-run --user --scope` containment wrapper, the spawn SHALL give the
wrapper the environment it needs to reach the user manager: `XDG_RUNTIME_DIR` and
`DBUS_SESSION_BUS_ADDRESS` when the daemon's own environment carries them. Exactly those variables
SHALL be removed from the command executed inside the scope, so a runtime whose child environment is an
explicit allowlist receives nothing beyond that allowlist — the wrapper's environment is not the
command's environment.

Where no systemd user manager is reachable, the spawn SHALL run uncontained exactly as before and SHALL
add no bus variable to the command's environment.

#### Scenario: A contained turn with a runtime dir set

- **WHEN** a turn whose child environment is an explicit allowlist is spawned with containment requested and available, and the daemon's environment carries `XDG_RUNTIME_DIR`
- **THEN** the `systemd-run` wrapper is spawned with `XDG_RUNTIME_DIR` in its environment, and the contained command is executed with `XDG_RUNTIME_DIR` and the other wrapper variables removed

#### Scenario: No runtime dir in the daemon environment

- **WHEN** containment is requested and available but the daemon environment sets neither `XDG_RUNTIME_DIR` nor `DBUS_SESSION_BUS_ADDRESS`
- **THEN** the wrapper is spawned with no bus variable and the contained command's environment is unchanged

#### Scenario: No user manager at all

- **WHEN** no systemd user manager is reachable at spawn time
- **THEN** the command runs uncontained exactly as before and no bus variable is added to its environment

### Requirement: A containment wrapper that cannot start fails in plain words

When containment is requested and reported available, but the `systemd-run` wrapper cannot reach the
user manager and exits before starting the runtime command, the turn SHALL fail with an error whose code
is `containment_unavailable` and whose message says, in plain words, that containment is unavailable.
It SHALL NOT be reported as a runtime crash carrying the wrapper's bus text, and the daemon SHALL NOT
silently re-run the command uncontained, because that would drop the memory containment the worker was
supposed to have.

#### Scenario: The wrapper cannot reach the user bus

- **WHEN** containment is requested, the availability check passes, and the wrapper exits without starting the command, writing its user-bus failure to stderr
- **THEN** the run ends with a `containment_unavailable` error of family `tooling` whose message says containment is unavailable, rather than with `agent_crashed` and the bus text

#### Scenario: A genuine runtime crash is still a runtime crash

- **WHEN** the contained command starts and later dies without a result
- **THEN** the outcome is classified as before (`agent_crashed`, or `killed` on a SIGKILL or exit 137), and not as containment-unavailable
