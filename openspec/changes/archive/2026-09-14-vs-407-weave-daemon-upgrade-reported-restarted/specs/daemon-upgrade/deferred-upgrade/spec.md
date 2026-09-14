## MODIFIED Requirements

### Requirement: A daemon starting up reconciles an unfinished upgrade

A daemon that starts while a record is in `restarting` SHALL reconcile it: if the release it is running is
the one the upgrade targeted, the upgrade SHALL be recorded as completed; if it is not, and the record has
been in `restarting` past a bounded interval, the upgrade SHALL be recorded as failed with a reason
identifying that the restart was not verified.

A record left in any pre-`restarting` non-terminal state by a daemon that is no longer running SHALL be
recorded as failed at startup, so a stale record never holds dispatch in the new process.

When such a pre-`restarting` record is failed at startup, its failure message SHALL state what actually
restarted the daemon rather than a bare statement that the daemon restarted: a service-management unit in
a restart loop, named with its active state and its restart count, or a daemon running outside its
installed unit — a manual start/restart. When neither can be determined on the host, the message SHALL
say so rather than inventing a cause.

#### Scenario: The new daemon is the upgrade's target

- **WHEN** a daemon starts while a record is restarting and the release it is running is that record's target
- **THEN** the upgrade is recorded as completed

#### Scenario: A restart came back on the wrong release

- **WHEN** a daemon starts while a record has been restarting past the bounded interval and the release it is running is not that record's target
- **THEN** the upgrade is recorded as failed with a reason identifying the unverified restart

#### Scenario: A daemon starts with an abandoned waiting record

- **WHEN** a daemon starts while a record is in a non-terminal state before restarting
- **THEN** that record is recorded as failed and the new daemon dispatches normally

#### Scenario: The abandoned record names a restart-looping unit

- **WHEN** a daemon starts while a record is in a non-terminal state before restarting, and the installed unit is in a restart loop
- **THEN** the failed record's message names the restart loop and the unit's active state and restart count

#### Scenario: The abandoned record names an out-of-service daemon

- **WHEN** a daemon starts while a record is in a non-terminal state before restarting, and the daemon that previously served was running outside its installed unit
- **THEN** the failed record's message states that a manual start/restart, not the unit, brought the daemon up
