## MODIFIED Requirements

### Requirement: The web app has a place that shows the update state and offers the upgrade

The web app SHALL have a section that reports the running version and release, the target ref and commit
when one is known, and whether an update is available. When an update is available it SHALL offer an
action that requests the upgrade; when none is available it SHALL offer no such action. It SHALL offer a
way to re-check on demand.

When update checking is not configured, the section SHALL say so and SHALL name what has to be configured
rather than showing an empty or failed state.

When the configured release source is stale, the section SHALL show a warning naming the source, the
repository the project now uses, and an action that changes the release source to that repository — in
addition to, not instead of, whatever the update answer is. The action SHALL report the server's error
when the change is refused, and SHALL report the change as applied when it succeeds. Without the stale
warning, the section SHALL offer no action that changes the release source.

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

#### Scenario: The release source is stale

- **WHEN** the section is opened while no update is available but the configured release source still names a repository a project was re-pointed away from
- **THEN** it shows a warning naming that source and the project's current repository, rather than only reporting the daemon as up to date, and offers an action that changes the release source

#### Scenario: Repairing a stale release source

- **WHEN** the operator uses the repair action while the release source is stale
- **THEN** the daemon's release source is changed to the project's current repository, the warning is gone, and the section reports the new source

#### Scenario: The repair is refused

- **WHEN** the repair is refused by the daemon
- **THEN** the section shows the reason and the warning remains

### Requirement: The CLI offers the same operations against the daemon

The CLI SHALL be able to read the daemon's update status, request a deferred upgrade, and cancel a pending
one — the same three operations the web app offers, against the same daemon, producing the same records.
Each SHALL have a machine-readable output form alongside its human-readable one.

The CLI SHALL also be able to read the daemon's configured release source and change it, with the same
validation and effect the web app's repair uses, and SHALL report a stale release source when it reads the
update status.

Requesting an upgrade from the CLI SHALL report that it was queued and SHALL be able to follow it to a
terminal state, including across the restart.

The existing local upgrade command SHALL keep working exactly as it does today, so a host whose daemon is
not answering can still be upgraded.

#### Scenario: Reading the update status

- **WHEN** the update status is read from the CLI
- **THEN** it reports the running version and release, the target when one is known, whether an update is available, and whether the release source is stale

#### Scenario: Changing the release source from the CLI

- **WHEN** the release source is changed from the CLI to a reachable repository at a ref that exists
- **THEN** the daemon records the change exactly as it does for the same change from the web app, and the CLI reports it as applied

#### Scenario: A refused release source change from the CLI

- **WHEN** the release source is changed from the CLI to an unreachable repository
- **THEN** the CLI reports the server's validation error and the configured source is unchanged

#### Scenario: Requesting a deferred upgrade

- **WHEN** an upgrade is requested from the CLI
- **THEN** the daemon records it exactly as it does for the same request from the web app, and the CLI reports it as queued

#### Scenario: Cancelling from the CLI

- **WHEN** a pending upgrade is cancelled from the CLI
- **THEN** the upgrade is cancelled and dispatch resumes, exactly as it does for the same request from the web app

#### Scenario: The local upgrade command is unchanged

- **WHEN** the existing local upgrade command is run
- **THEN** it behaves as it did before this capability existed
