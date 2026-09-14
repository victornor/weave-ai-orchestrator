# daemon-upgrade/restart-safety Specification

## Purpose
Guarantees that a daemon restart either demonstrably takes — the installed unit runs without a restart
loop and the daemon answering on the listen address serves the target release — or is refused or
reported failed with the cause, so no upgrade ever reports `restarted` while an old, out-of-service or
crash-looping daemon keeps serving.

## Requirements

### Requirement: A detached daemon is reconciled against an installed unit

When a service-management unit is installed and the daemon's own pid file names a live process whose
command line is this product's server binary and whose PID is not the unit's main PID, the CLI SHALL
treat it as a detached daemon and reconcile it on `start`, `stop`, `restart` and `upgrade`.

Reconciliation SHALL `SIGTERM` that exact PID — never a process matched by name or pattern — after
verifying both that its command line is this product's server binary and that it holds the configured
listen address, and SHALL then wait, bounded, for it to exit and for the listen address to be free
before it continues with the unit. On `stop`, `restart` and `upgrade` it SHALL continue that way rather
than returning after only asking the unit to stop. On `start`, rather than reporting "already running",
it SHALL report that a detached daemon is running and hand over to the unit.

The stale pid file SHALL be removed once the detached process has exited. A process whose command line
cannot be verified as this product's server, or which does not hold the listen address, SHALL NOT be
signalled; the CLI SHALL report it and stop rather than guess.

Signalling a detached daemon is the explicit human command's action alone. The daemon's own deferred
self-upgrade — and the restart runner it launches — and `weave doctor` SHALL NOT signal any process:
they refuse or report a detached daemon instead. The `stop`, `restart`, `upgrade` and `start` above are
commands a human runs to stop or replace this daemon.

#### Scenario: A detached daemon holds the port when an upgrade restarts

- **WHEN** a unit is installed, the pid file names a live process running this product's server that holds the listen address and is not the unit's main PID, and stop/restart/upgrade runs
- **THEN** that exact PID is `SIGTERM`ed, the CLI waits for it to exit and the address to free, removes the stale pid file, and continues with the unit

#### Scenario: Start finds a detached daemon

- **WHEN** `weave daemon start` runs while a unit is installed and the pid file names a live detached daemon
- **THEN** it reports the detached daemon and hands over to the unit instead of reporting "already running"

#### Scenario: The deferred self-upgrade never signals the detached daemon

- **WHEN** the daemon's own deferred self-upgrade (or its restart runner) finds a verified detached daemon holding the listen address
- **THEN** nothing is signalled, and the upgrade is refused with the holder's PID and the remedy

#### Scenario: Doctor never signals the detached daemon

- **WHEN** `weave doctor` finds a verified detached daemon holding the listen address
- **THEN** nothing is signalled, and it is reported with the handover remedy

#### Scenario: The tracked pid is not this product

- **WHEN** the pid file names a live process whose command line is not this product's server binary
- **THEN** it is not signalled, and the CLI reports it rather than stopping or restarting anything

#### Scenario: The process no longer holds the address

- **WHEN** the pid file names a live process that no longer holds the configured listen address
- **THEN** it is not signalled, and the CLI reports the discrepancy

### Requirement: A restart is refused when the listen address is held outside the service unit

Before any restart — `weave daemon upgrade`, `weave daemon restart`, `weave daemon rollback`, and the
daemon's own deferred self-upgrade — the system SHALL determine whether a service-management unit is
installed and whether the daemon's configured listen address is held by a process. For the local CLI
commands, a holder that is the tracked detached daemon, verified as this product's server binary, is
reconciled per the requirement above and the restart proceeds; for the daemon's own deferred self-upgrade
it is refused per that requirement's no-signalling rule. A holder that is not the installed unit's main
PID and cannot be so identified SHALL cause the restart to be refused before any process is signalled and
before the unit is asked to restart.

The refusal SHALL name the holding PID, its command line, the release path it runs from when that can be
read, and state that the unit cannot bind until that process stops. No process SHALL be killed
automatically in that case; stopping the holder is the operator's action.

A host with no installed unit, or a listen address nothing is holding, SHALL proceed exactly as before.

#### Scenario: The port is held by an unidentifiable process outside the unit

- **WHEN** a unit is installed and the listen address is held by a process that is neither the unit's main PID nor the verified tracked detached daemon
- **THEN** the restart is refused, the holder's PID, command and release path are printed with a message saying the unit cannot bind until it stops, and nothing is signalled

#### Scenario: The port is held by the unit's own process

- **WHEN** a unit is installed and the listen address is held by the unit's main PID
- **THEN** the restart proceeds

#### Scenario: No unit is installed

- **WHEN** no service-management unit is installed
- **THEN** the preflight finds no unit to compare against and the restart proceeds exactly as before

#### Scenario: Nothing holds the listen address

- **WHEN** a unit is installed and nothing is listening on the listen address
- **THEN** the restart proceeds

### Requirement: A restart is reported successful only when the target release is serving

After a restart, the system SHALL wait a bounded interval for all of: the installed unit is
`active (running)` without a restart loop, the daemon serving on the listen address is confirmed to be
the unit's own process — the unit's main PID, or a process in the unit's cgroup — and that process
reports the target release, by its release path or by the commit it was built from.

Only when all of these hold SHALL the operation print `restarted`. When they do not hold within the
bound, the operation SHALL report the restart failed, name the cause (for example `EADDRINUSE` or a
restart loop) and the release actually serving, and SHALL NOT print `restarted`.

For a restart carried out without a unit, where there is none to consult, verification SHALL be on the
release being served alone.

#### Scenario: The new release comes back and serves

- **WHEN** the unit reaches active (running) and the unit's own process serving on the listen address reports the target release
- **THEN** the operation reports the restart as succeeding

#### Scenario: A process outside the unit answers

- **WHEN** a daemon reports the target release on the listen address but is not the unit's main PID and is not in its cgroup
- **THEN** the operation does not report the restart as succeeding, and reports the process that actually served

#### Scenario: The unit is in a restart loop

- **WHEN** the installed unit's restart counter climbs, or its active state stays `activating`/`failed`, for the whole bounded interval
- **THEN** the operation reports the restart failed, names the restart loop, and names the release actually serving

#### Scenario: A different release answers

- **WHEN** a daemon answers but reports a release other than the target
- **THEN** the operation reports the restart failed and names the release actually running, and does not report it restarted

### Requirement: A drain that cannot reach a reachable daemon refuses the restart

A drain performed before a restart SHALL distinguish "nothing is there to drain" from "something is
there but the drain call failed". Only when nothing is listening on the daemon's own listen address
SHALL the drain be skipped and the restart proceed. When the listen address is reachable but the drain
call fails, the restart SHALL be refused and the message SHALL carry the drain failure's cause, rather
than silently skipping the drain.

#### Scenario: Nothing is listening

- **WHEN** the daemon's listen address has no listener and the drain call cannot connect
- **THEN** the drain is skipped and the restart proceeds

#### Scenario: A daemon is serving but the drain fails

- **WHEN** something is listening on the listen address and the drain call fails, for example because the configured context URL is unreachable or fails TLS
- **THEN** the restart is refused and the message names the drain failure

### Requirement: `weave doctor` reports an out-of-service daemon and a restart-looping unit

On the host confirmed to run the daemon, `weave doctor` SHALL report, each with its exact remedy: an
out-of-service daemon holding the listen address (a listening process that is not the installed unit's
main PID), and an installed unit in a restart loop (its restart counter climbing, or its active state
`activating`/`failed` while a unit is installed).

It SHALL also report the local daemon process state correctly: a unit-managed daemon — which writes
`daemon.json`, not the pid file — SHALL read as healthy rather than "not started from this machine", and
a detached daemon coexisting with an installed unit SHALL be reported as a warning naming the handover
remedy, not as healthy.

These checks SHALL run only on the confirmed local daemon host, so a client machine never reports on a
unit it does not own.

#### Scenario: An out-of-service daemon holds the port

- **WHEN** doctor runs on the daemon host while a process outside the unit holds the listen address
- **THEN** it reports the condition with the holder's PID and the remedy to stop that process by hand

#### Scenario: The unit is in a restart loop

- **WHEN** doctor runs on the daemon host while the installed unit's restart counter is climbing or its active state is failed/activating
- **THEN** it reports the condition with the counter or state and the remedy

#### Scenario: A unit-managed daemon is healthy

- **WHEN** doctor runs on the daemon host while the installed unit is active and owns the listen address, and no pid file exists (or it names the unit's main PID)
- **THEN** the local daemon process reads as healthy, not as "not started from this machine"

#### Scenario: A detached daemon coexists with the unit

- **WHEN** doctor runs on the daemon host while the pid file names a live detached daemon and a unit is installed
- **THEN** it reports the detached daemon as a warning with the handover remedy

#### Scenario: A healthy host

- **WHEN** doctor runs on the daemon host with the unit active and the unit's own process holding the listen address
- **THEN** none of these conditions is reported
