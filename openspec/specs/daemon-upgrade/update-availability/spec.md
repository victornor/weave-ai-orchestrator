# daemon-upgrade/update-availability Specification

## Purpose
Defines how the daemon determines whether the release it is running is behind the source it is configured
to build from, what it reports when there is nothing to compare against, and how that answer is kept
current — so an operator learns that an update exists without opening a shell on the host.

## Requirements

### Requirement: The daemon reports the release it is running

The daemon SHALL report the identity of the release it is currently executing: its version, the commit it
was built from, and the release directory. This SHALL be derived from the running process, not from the
`current` symlink, so a daemon that is still serving an older release after the symlink moved reports the
release it is actually running.

When the commit cannot be determined, the report SHALL say so explicitly rather than reporting a wrong or
empty commit.

#### Scenario: A daemon running from a release directory

- **WHEN** the running release is asked for
- **THEN** the daemon reports its version, the commit it was built from, and the directory it is running from

#### Scenario: The symlink has moved but the daemon has not restarted

- **WHEN** the `current` symlink points at a release other than the one the process is executing
- **THEN** the reported running release is the one the process is executing, not the one the symlink names

#### Scenario: The commit cannot be determined

- **WHEN** the running release carries no recoverable commit
- **THEN** the report identifies the release without a commit, and does not report a commit it did not determine

### Requirement: The daemon compares the running release against the configured source

When a release source is configured, the daemon SHALL resolve the commit that source currently has at the
configured ref, without cloning it and without modifying the running installation, and SHALL report an
update as available exactly when that commit differs from the running release's commit.

The comparison SHALL report both sides — the running commit and the target commit with the ref it came
from — so what the upgrade would move to is visible before it is requested.

The comparison SHALL also report the repository the running release was built from, and whether the
configured source still names a repository that a workspace project has been re-pointed away from (see
`daemon-upgrade/release-source-mismatch`). That report SHALL be independent of whether an update is
available.

#### Scenario: The source is ahead of the running release

- **WHEN** the configured source at the configured ref has a commit different from the running release's
- **THEN** an update is reported as available, with the running commit and the target commit and ref

#### Scenario: The source matches the running release

- **WHEN** the configured source at the configured ref has the same commit as the running release's
- **THEN** no update is reported as available, and both commits are still reported

#### Scenario: The source cannot be reached

- **WHEN** resolving the configured source fails
- **THEN** the check reports the failure and its reason, no update is reported as available, and the previously reported running release is still reported

#### Scenario: The running release reports the repository it came from

- **WHEN** the update status is read and the running release's build carries a repository origin
- **THEN** the status reports that repository, and reports no source repository when it cannot be determined

#### Scenario: A stale source is reported with the comparison

- **WHEN** the update status is read while the configured source still names a repository the running release came from and a project has been re-pointed away from it
- **THEN** the status reports the mismatch alongside the update answer, including when the source resolves to the running commit

### Requirement: A daemon with no configured source reports that it cannot check

When no release source is configured, the daemon SHALL report that update checking is not configured. It
SHALL NOT report an update as available, SHALL NOT report a check failure, and SHALL NOT attempt to reach
any remote.

#### Scenario: No source is configured

- **WHEN** the update check runs with no release source configured
- **THEN** it reports that checking is not configured, reports no update as available, and reports no error

### Requirement: The update answer is cached and can be refreshed on demand

The result of a comparison SHALL be cached for a configurable interval and reported with the time it was
taken, so repeated reads do not reach the network. A refresh SHALL be requestable explicitly, and SHALL
resolve the source again regardless of the cache.

#### Scenario: Two reads within the caching interval

- **WHEN** the update status is read twice within the caching interval
- **THEN** the source is resolved once, and both reads report the same answer with the same check time

#### Scenario: An explicit refresh

- **WHEN** a refresh is requested
- **THEN** the source is resolved again and the reported check time advances, even if the cached answer had not expired
