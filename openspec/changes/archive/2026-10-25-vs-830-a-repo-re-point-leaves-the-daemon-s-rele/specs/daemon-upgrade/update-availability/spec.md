## MODIFIED Requirements

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
