## ADDED Requirements

### Requirement: A Host tools section sits in the daemon area

The daemon settings SHALL hold a **Host tools** section listing the daemon host's git, gh, openspec
and wt tools and their availability, and offering the `hostToolPaths` directories for editing as a
daemon-level setting. It SHALL be reachable by its section key from a link, and changing it SHALL
not change any workspace setting.

#### Scenario: The section is filed under the daemon area

- **WHEN** the daemon settings are opened at the host-tools section
- **THEN** the Host tools section is shown, and the workspace settings do not offer it

#### Scenario: The section is deep-linkable

- **WHEN** a link opens either settings destination naming the host-tools section key
- **THEN** the daemon settings open at the Host tools section
