# daemon-upgrade/upgrade-surfaces Specification

## Purpose
Defines what the operator sees and can do about daemon updates from the web app and from the CLI: how an
available update announces itself, how an upgrade is started and cancelled, how its progress is followed
across the restart that kills the connection, and how its outcome is shown afterwards.

## Requirements

### Requirement: The web app announces an available update without being asked

When an update is available, the web app SHALL show an indicator in its navigation, so an operator who is
not looking at settings learns that one exists. When no update is available, when checking is not
configured, or when the check failed, the navigation SHALL show nothing.

#### Scenario: An update is available

- **WHEN** the daemon reports an update as available
- **THEN** the navigation shows an update indicator

#### Scenario: The daemon is up to date

- **WHEN** the daemon reports no update as available
- **THEN** the navigation shows no update indicator

#### Scenario: Update checking is not configured

- **WHEN** the daemon reports that update checking is not configured
- **THEN** the navigation shows no update indicator and no error

### Requirement: The web app has a place that shows the update state and offers the upgrade

The web app SHALL have a section that reports the running version and release, the target ref and commit
when one is known, and whether an update is available. When an update is available it SHALL offer an
action that requests the upgrade; when none is available it SHALL offer no such action. It SHALL offer a
way to re-check on demand.

When update checking is not configured, the section SHALL say so and SHALL name what has to be configured
rather than showing an empty or failed state.

#### Scenario: An update is available

- **WHEN** the section is opened while an update is available
- **THEN** it shows the running version and release, the target ref and commit, and an action that requests the upgrade

#### Scenario: The daemon is up to date

- **WHEN** the section is opened while no update is available
- **THEN** it shows the running version and release and offers no upgrade action

#### Scenario: Checking is not configured

- **WHEN** the section is opened while update checking is not configured
- **THEN** it says so and names what has to be configured, and offers no upgrade action

#### Scenario: Re-checking on demand

- **WHEN** the operator asks the section to check again
- **THEN** the daemon resolves the source again and the section shows the refreshed answer and its check time

### Requirement: Requesting the upgrade shows it as pending and offers to cancel it

Using the upgrade action SHALL show the upgrade as pending rather than reporting it as done, and SHALL
report what it is waiting for while it waits. While it is still cancellable, the section SHALL offer a
cancel action; using it SHALL return the section to showing the available update and SHALL NOT leave a
pending upgrade behind.

Once the upgrade is no longer cancellable, the cancel action SHALL no longer be offered.

#### Scenario: The upgrade is queued behind running work

- **WHEN** the upgrade is requested while work is running
- **THEN** the section shows it as pending, reports the work it is waiting for, and offers to cancel it

#### Scenario: Cancelling a pending upgrade

- **WHEN** the operator cancels a pending upgrade
- **THEN** the section stops showing a pending upgrade and shows the available update again

#### Scenario: The build has started

- **WHEN** the upgrade has reached the build stage
- **THEN** the section no longer offers to cancel it

### Requirement: Progress is followed across the restart and the outcome is shown

While an upgrade is not in a terminal state, the section SHALL keep the state it shows current without the
operator reloading, and SHALL show the stage the upgrade is in and the tail of its output.

While the daemon is restarting, the section SHALL show that it is restarting and SHALL keep trying to
reach the daemon; once a healthy daemon answers, it SHALL show the outcome and the version the daemon came
back on. A failed upgrade SHALL show its reason and the tail of its output, and SHALL show the version that
is still running.

#### Scenario: Following a build

- **WHEN** the upgrade is building
- **THEN** the section shows the build stage and the tail of its output, updating without a reload

#### Scenario: The daemon restarts

- **WHEN** the daemon becomes unreachable during the restart stage
- **THEN** the section shows that the daemon is restarting and keeps trying to reach it

#### Scenario: The daemon comes back

- **WHEN** a healthy daemon answers after the restart
- **THEN** the section shows the upgrade as completed and the version the daemon came back on

#### Scenario: The upgrade failed

- **WHEN** the upgrade reached a failed terminal state
- **THEN** the section shows the failure reason and the tail of its output, and shows the version that is still running

### Requirement: The CLI offers the same operations against the daemon

The CLI SHALL be able to read the daemon's update status, request a deferred upgrade, and cancel a pending
one — the same three operations the web app offers, against the same daemon, producing the same records.
Each SHALL have a machine-readable output form alongside its human-readable one.

Requesting an upgrade from the CLI SHALL report that it was queued and SHALL be able to follow it to a
terminal state, including across the restart.

The existing local upgrade command SHALL keep working exactly as it does today, so a host whose daemon is
not answering can still be upgraded.

#### Scenario: Reading the update status

- **WHEN** the update status is read from the CLI
- **THEN** it reports the running version and release, the target when one is known, and whether an update is available

#### Scenario: Requesting a deferred upgrade

- **WHEN** an upgrade is requested from the CLI
- **THEN** the daemon records it exactly as it does for the same request from the web app, and the CLI reports it as queued

#### Scenario: Cancelling from the CLI

- **WHEN** a pending upgrade is cancelled from the CLI
- **THEN** the upgrade is cancelled and dispatch resumes, exactly as it does for the same request from the web app

#### Scenario: The local upgrade command is unchanged

- **WHEN** the existing local upgrade command is run
- **THEN** it behaves as it did before this capability existed
