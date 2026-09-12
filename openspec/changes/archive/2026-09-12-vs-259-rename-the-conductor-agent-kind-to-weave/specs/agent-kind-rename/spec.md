## Purpose

Defines the guarantees an existing installation gets when the `conductor` agent kind's stored
identity is renamed to `weaver`: every constraint that names the value moves together with the rows
that carry it, the one-agent-of-this-kind-per-workspace invariant keeps holding, and nothing that
already resolves the agent's runtime-home directory is orphaned by the rename.

## ADDED Requirements

### Requirement: Existing `conductor`-kind rows read as `weaver` after migration, with no data loss

When this migration runs against a database that already has rows using the `conductor` value — an
agent of that kind, decisions it owns, roles it created — every one of those rows SHALL read with the
`weaver` value afterwards, and no row, column, or relationship on it SHALL be lost or altered beyond
the renamed value itself.

#### Scenario: A live conductor agent survives the rebuild

- **WHEN** the migration runs against a database containing an `agents` row with `kind = 'conductor'`
- **THEN** after migration that same row (same id, same other columns) has `kind = 'weaver'`, and it
  is still readable by every query that selects agents by workspace

#### Scenario: Decisions owned by the conductor survive the rebuild

- **WHEN** the migration runs against a database containing `decisions` rows with `owner = 'conductor'`
- **THEN** after migration those rows have `owner = 'weaver'`, keep their original id, ticket
  association, and every other column, and remain readable

#### Scenario: Roles created by the conductor survive the rebuild

- **WHEN** the migration runs against a database containing `roles` rows with
  `created_by = 'conductor'`
- **THEN** after migration those rows have `created_by = 'weaver'`, and every other column on them is
  unchanged

#### Scenario: Role revision history authored by the conductor survives the migration

- **WHEN** the migration runs against a database containing `role_revisions` rows with
  `author = 'conductor'`
- **THEN** after migration those rows have `author = 'weaver'`, keep their revision number and every
  other column, and remain readable in revision order

#### Scenario: Incident reports filed by the conductor survive the migration

- **WHEN** the migration runs against a database containing `incidents` rows with
  `reporter_kind = 'conductor'`
- **THEN** after migration those rows have `reporter_kind = 'weaver'`, and every other column on them
  is unchanged

#### Scenario: A row already using a value the migration does not touch is unaffected

- **WHEN** the migration runs against `agents`, `decisions`, or `roles` rows that already carry
  `'worker'`, `'human'`, or `'system'` in the renamed column
- **THEN** those rows are unchanged by the migration

### Requirement: The one-weaver-per-workspace invariant holds after the rebuild

A workspace SHALL continue to be able to hold at most one agent of the renamed kind, exactly as it
could hold at most one `conductor`-kind agent before this migration. The invariant SHALL be enforced
by the database itself, not only by application code.

#### Scenario: A second weaver-kind agent is rejected

- **WHEN** a workspace already has one agent with `kind = 'weaver'` and an insert attempts to add a
  second agent with `kind = 'weaver'` in the same workspace
- **THEN** the insert is rejected by the database's own constraint

#### Scenario: A second worker-kind agent is unaffected

- **WHEN** a workspace already has one or more agents with `kind = 'worker'` and an insert adds
  another agent with `kind = 'worker'` in the same workspace
- **THEN** the insert succeeds, exactly as it did before this migration

### Requirement: An existing workspace's agent-kind runtime-home directory is not orphaned

After this migration, an existing workspace's per-workspace runtime-home directory for this agent
kind SHALL still be found by the system, without requiring that directory to be renamed, moved, or
recreated as a side effect of the database migration.

#### Scenario: An existing workspace's runtime home is still found

- **WHEN** a workspace has an on-disk runtime-home directory for this agent kind created before this
  migration, and the migration is applied to that workspace's database
- **THEN** the system still resolves and uses that same on-disk directory as the agent's runtime home,
  with no error and no silent creation of a second, empty one

### Requirement: No reachable identity value for this agent kind remains spelled `conductor`

Every stored value, constraint, and default that identifies an agent, a decision owner, or a role
creator of this kind SHALL use `weaver`. Nothing that compares against, filters by, or displays this
agent kind's identity SHALL accept, produce, or match `conductor` after this migration completes.

#### Scenario: Filtering agents by kind uses the new value

- **WHEN** a caller lists agents filtered to this agent kind after the migration
- **THEN** the filter matches on `weaver` and returns the renamed rows; a filter for `conductor`
  matches nothing

#### Scenario: A newly created agent of this kind is stored under the new value

- **WHEN** a workspace with no existing agent of this kind provisions one after the migration
- **THEN** the new agent's stored kind is `weaver`
