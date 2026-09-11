## Purpose

Defines how the daemon and CLI find their own configuration, data, state and per-workspace
directories when the product is known under two possible names on disk (an old one and a new one),
so a source-level rename never orphans a directory an existing installation already depends on.

## ADDED Requirements

### Requirement: A directory that may exist under either of two names resolves to whichever exists

For every directory this capability governs, the system SHALL resolve to the new-named directory
when only it exists, to the old-named directory when only it exists, and to the new-named directory
when neither exists (a fresh install). No implicit move, copy or deletion SHALL ever occur as a side
effect of this resolution.

#### Scenario: Only the old-named directory exists

- **WHEN** the old-named directory is present on disk and the new-named one is not
- **THEN** every path under that directory family resolves under the old name, and behavior is
  unchanged from before this capability existed

#### Scenario: Only the new-named directory exists

- **WHEN** the new-named directory is present on disk and the old-named one is not
- **THEN** every path under that directory family resolves under the new name

#### Scenario: Neither directory exists

- **WHEN** neither the old-named nor the new-named directory is present
- **THEN** the system resolves to the new name, as a fresh install would

#### Scenario: Resolution never migrates anything

- **WHEN** the system resolves a directory family under either name
- **THEN** no file or directory is moved, copied, symlinked or deleted as a result of that resolution

### Requirement: A directory present under both names is a refused, loud ambiguity

When both the old-named and the new-named directory exist for the same directory family, the system
SHALL refuse to silently pick one. It SHALL raise an error naming both candidate paths, rather than
proceeding with either.

#### Scenario: Both names exist for a user-level directory

- **WHEN** the daemon or CLI resolves a user-level directory (configuration, data, or state) and both
  the old-named and new-named directory exist
- **THEN** resolution fails with an error that names both paths, and no further action is taken on
  either directory

#### Scenario: Both names exist for a workspace's own state directory

- **WHEN** a workspace's per-workspace state directory is resolved and a database file exists under
  both the old-named and new-named directory for that workspace
- **THEN** resolution fails with an error naming both paths, and the daemon does not open, create, or
  otherwise touch either database

### Requirement: An explicit directory override bypasses name resolution entirely

When an operator has explicitly named a directory (an environment override or an equivalent explicit
argument, as already supported before this capability), the system SHALL use exactly the directory
given, with no old/new resolution and no possibility of the ambiguity refusal.

#### Scenario: An explicit override is used verbatim

- **WHEN** an explicit directory override is given for a directory this capability would otherwise
  resolve
- **THEN** the system uses that directory exactly as given, regardless of what old-named or
  new-named directories exist on disk

### Requirement: A workspace's per-workspace directories resolve together, as one installation

A single workspace's per-workspace state directory and its conductor-agent home directory SHALL
resolve under the same name as each other — both old, both new, or both fresh — never one under each
name, keyed on which name's state directory already holds that workspace's database.

#### Scenario: An existing workspace is recognised as already initialised

- **WHEN** a workspace's state directory holds a database under the old name and no database exists
  under the new name
- **THEN** the workspace is resolved as an existing installation under the old name, not treated as
  uninitialised, and its conductor-agent home resolves under the old name too

#### Scenario: A fresh workspace gets both directories under the new name

- **WHEN** a workspace has no database under either name
- **THEN** its state directory and its conductor-agent home both resolve under the new name
