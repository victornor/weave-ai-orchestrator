# daemon-upgrade/running-version Specification

## Purpose
Defines the identity shown as the running version of the daemon and the CLI: the git sha of the release the process is executing, not a hardcoded package version.

## Requirements

### Requirement: The running version is the release git sha

The version string a process reports for itself SHALL be the git sha of the release directory that process is executing from. That directory SHALL be derived from the process, not from the `current` symlink.

The sha used as the version SHALL be the same identity already recoverable from that release (the clone's HEAD, or the sha in a `releases/<stamp>-<sha>` directory name). It SHALL be shortened to the length the release directory name already uses when the recovered commit is longer.

WHEN the sha cannot be determined, the version SHALL be an explicit unknown value. It SHALL NOT be a hardcoded package version such as `0.1.0` presented as the running version.

`GET /api/health` `version` and `release.version` SHALL use that string. `release.sha` SHALL remain the full recovered commit when it is known, or null when it is not, so upgrade comparison is unchanged.

#### Scenario: Health after an upgrade

- **WHEN** the daemon is executing from a release directory named with a stamp and a git sha
- **THEN** `GET /api/health` reports that sha as `version` (and as `release.version`), not `0.1.0`, and still reports the release directory and the recovered commit

#### Scenario: The process is not in a named release directory but the commit is known

- **WHEN** the process is executing from a git checkout whose commit can be recovered
- **THEN** the reported version is that commit's sha, not a hardcoded package version

#### Scenario: The commit cannot be determined

- **WHEN** neither the release clone nor the directory name yields a git sha
- **THEN** the reported version is an explicit unknown value, not `0.1.0`

#### Scenario: The symlink has moved but the process has not restarted

- **WHEN** the `current` symlink points at a different release than the one the process is executing
- **THEN** the reported version is the sha of the process's own release, not the symlink's

### Requirement: Surfaces that show the running version show the git sha

Every operator-facing surface that presents "the running version" SHALL show that version string as the primary label. It SHALL NOT print a hardcoded `0.1.0` as if it were the running daemon. A git-sha version SHALL NOT be prefixed with `v` as if it were semver.

The surfaces this covers are: `conductor --version` (the CLI binary's own release), `conductor daemon status`, `conductor doctor`'s daemon line, `conductor daemon restart` / upgrade outcome lines, the web Login footer, and the Settings "This daemon" Version row (and the upgrade outcome's "now running" / "still running" values).

The release stamp from a `releases/<stamp>-<sha>` directory name MAY be shown alongside the sha on status and Settings. Upgrade comparison, `upgrade.source`, and `upgrade.ref` SHALL NOT change.

#### Scenario: Daemon status after an upgrade

- **WHEN** `conductor daemon status` reads health from a daemon running a named release
- **THEN** the version field is that release's git sha, not `0.1.0`

#### Scenario: CLI version is not the daemon's hardcoded package version

- **WHEN** `conductor --version` is invoked from a CLI built as part of a release
- **THEN** it prints that release's git sha, not `0.1.0`

#### Scenario: Settings and Login show the sha

- **WHEN** the web app shows the running daemon's version on Login or on Settings
- **THEN** the label is the git sha (optionally with the release stamp), not `v0.1.0`

#### Scenario: An upgrade announcement names the sha, not v0.1.0

- **WHEN** a completed upgrade is announced
- **THEN** the human-readable release label names the git sha and does not read `v0.1.0 (<sha>)`
