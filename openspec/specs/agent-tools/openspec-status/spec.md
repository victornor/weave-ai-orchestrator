# agent-tools/openspec-status Specification

## Purpose
TBD - created by archiving change vs-318-the-daemon-silently-loses-openspec-and-g. Update Purpose after archive.

## Requirements

### Requirement: weave_openspec_status reports a host-tool failure

When the openspec binary cannot be executed — not found on the daemon's `PATH`, or present but
failing to run — `weave_openspec_status` SHALL return an error that names the real condition,
rather than a status object claiming the planning is incomplete with no artifacts. A ticket whose
change has no `openspec` directory, or whose project does not use OpenSpec, SHALL still return the
zeroed status.

#### Scenario: An unrunnable binary is an error

- **WHEN** `weave_openspec_status` is called for a ticket whose change exists but the openspec binary cannot be executed
- **THEN** the tool returns `ok: false` with an error naming the host-tool condition, not an empty plan

#### Scenario: A project without OpenSpec still returns a zeroed status

- **WHEN** `weave_openspec_status` is called for a ticket whose project has no `openspec` directory
- **THEN** the tool returns the zeroed status with `planningComplete: false` and no error
