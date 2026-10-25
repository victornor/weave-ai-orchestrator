## Purpose

Detect, surface and repair a daemon release source that a project's repository re-point left naming the project's previous repository, so upgrades never keep building from an archived repo while the operator believes they come from the new one.

## ADDED Requirements

### Requirement: A stale release source is detected against the project the running release came from

The daemon SHALL identify the repository the running release was built from, and SHALL determine whether that repository is a previous repository of one of the workspace's projects — that is, whether a project's recorded repo URL has since moved away from it.

The configured release source SHALL be reported as stale exactly when it still names that previous repository, and it SHALL be reported as stale only on that basis: a source that names some other repository — the operator's independent choice — SHALL NOT be reported as stale, even when the running release came from a repository that has been re-pointed.

#### Scenario: The source still names the previous repository

- **WHEN** the release this daemon runs from was built from repository A, a project that used that repository has been re-pointed to B, and the configured release source is A at its ref
- **THEN** the update status reports the mismatch, naming A as the configured source, B as the project's current repository, and the project

#### Scenario: The source already names the new repository

- **WHEN** the running release came from repository A and a project was re-pointed to B, and the configured release source is B
- **THEN** no mismatch is reported

#### Scenario: The source is an independent choice

- **WHEN** the running release came from repository A and a project was re-pointed away from A, and the configured release source names a repository C that is not A
- **THEN** no mismatch is reported, and the source is reported exactly as configured

#### Scenario: No project used the running release's repository

- **WHEN** no project's current or previous repository is the repository the running release was built from
- **THEN** no mismatch is reported

#### Scenario: The running release's repository cannot be determined

- **WHEN** the running release carries no recoverable repository identity
- **THEN** no mismatch is reported, and nothing about the source is reported as stale

### Requirement: A mismatch is not reported as an up-to-date source

While the configured release source is stale, the update status SHALL report the mismatch alongside — not instead of — the normal comparison against that source, so a source that currently matches the running commit because the old repository is still reachable is never shown as merely up to date.

#### Scenario: Stale source that still resolves

- **WHEN** the configured release source is stale and its ref resolves to the running release's commit
- **THEN** the status reports no update as available, and reports the mismatch

#### Scenario: Stale source that cannot be resolved

- **WHEN** the configured release source is stale and resolving it fails
- **THEN** the status reports the check failure and the mismatch

### Requirement: The release source can be changed from the daemon without a restart

The daemon SHALL accept an operator-only change of its release source — a URL and optionally a ref — validate it, persist it, and apply it to the running daemon's update checking and upgrade requests without a restart.

Validation SHALL require that the source is reachable and that the ref exists there, and SHALL reject a source or ref that fails either check without changing the configured source. Persisting the change SHALL write it to the daemon's configuration file, so it survives a restart.

#### Scenario: A valid source is applied

- **WHEN** an operator sets the release source to a reachable repository at a ref that exists there
- **THEN** the change is accepted, the update status reports the new source and ref, and a subsequent upgrade request uses it

#### Scenario: The source survives a restart

- **WHEN** the release source has been changed through the daemon
- **THEN** the daemon's configuration file records it, and a daemon started later reports the same source

#### Scenario: An unreachable source is refused

- **WHEN** the requested source cannot be reached
- **THEN** the request fails with a validation error naming the source, and the configured source and ref are unchanged

#### Scenario: A missing ref is refused

- **WHEN** the requested ref does not exist on the requested source
- **THEN** the request fails with a validation error naming the ref, and the configured source and ref are unchanged

#### Scenario: The daemon has no configuration directory

- **WHEN** the daemon was started without a configuration directory to write to
- **THEN** the change fails with an error saying it cannot be persisted, rather than being applied only in memory

### Requirement: A changed source takes effect for update checking immediately

After the release source is changed, the next update check SHALL resolve the new source rather than answer from a cached result for the previous one.

#### Scenario: The cached answer is discarded

- **WHEN** the update status was checked, cached, and then the release source is changed
- **THEN** the next update status read resolves the new source and reports it

### Requirement: A project re-point reports whether it left the release source stale

A project's repo URL changing SHALL report, with the update, whether the daemon's release source still names the project's previous URL, so the caller can offer to move it.

That report SHALL NOT change the release source by itself: moving it SHALL be a separate, explicit action.

#### Scenario: The re-point leaves the source on the old URL

- **WHEN** a project is re-pointed from A to B and the daemon's release source is A
- **THEN** the update reports that the release source still names A, and that B is the new URL

#### Scenario: The source names something else

- **WHEN** a project is re-pointed from A to B and the daemon's release source is not A
- **THEN** the update does not report the release source as left behind

#### Scenario: The release source is untouched

- **WHEN** a project is re-pointed and the release source named its previous URL
- **THEN** the configured release source is still the previous URL until it is changed explicitly

### Requirement: The operator is told the migration step

The documentation that describes re-pointing a project's repository SHALL state that the daemon's release source is a separate setting, and SHALL say how to check and change it.

#### Scenario: Reading the re-point documentation

- **WHEN** an operator reads how to re-point a project's repository
- **THEN** it says the daemon's release source is separate and names how to see and change it
