## ADDED Requirements

### Requirement: A workspace setting masked by a filled daemon overlay is cleared once, preserving the value already in force

When a workspace already holds the two model settings (having already been through, or never
needed, the migration in "An existing workspace arrives at the two settings by itself") and that
workspace loads for the first time under the inverted precedence defined by
`model-selection/daemon-overrides` and `model-selection/workspace-model-settings`, the system
SHALL, once per workspace, clear the workspace's stored weaver setting, workers setting, or
worker-options catalog for any control whose matching daemon overlay is filled at that moment —
because under the precedence in force immediately before this migration, that daemon overlay was
already the effective value, and the workspace's stored value for that control had no observable
effect no matter what it held. A control whose matching daemon overlay is not filled at that
moment SHALL be left untouched: it was already the effective value before this migration and
remains so after it.

This SHALL run exactly once per workspace. A workspace already migrated SHALL NOT be re-evaluated
on a later load, even if the daemon's overlays change afterward, and a value a human configures
after this migration has run is a deliberate choice, never a candidate for automatic clearing.

The system SHALL record, at the point this migration runs, which controls it cleared and what
value now governs each in its place, in a form an operator can find without diffing the
workspace's configuration file by hand.

#### Scenario: A masked workers setting is cleared, so the daemon's value keeps governing

- **WHEN** a workspace has a stored workers setting and the daemon's workers overlay is filled at
  the moment this workspace first loads under the inverted precedence
- **THEN** the workspace's stored workers setting is cleared
- **AND** the workspace's effective workers setting after the migration is exactly the daemon
  overlay's value — the same value that was already governing before the migration ran

#### Scenario: An unmasked setting is left alone

- **WHEN** a workspace has a stored weaver setting and the daemon's weaver overlay is empty at the
  moment this workspace first loads under the inverted precedence
- **THEN** the workspace's stored weaver setting is unchanged
- **AND** it remains the effective weaver setting after the migration, exactly as it was before the
  migration ran

#### Scenario: A masked worker-options catalog is cleared

- **WHEN** a workspace has a non-empty worker-options catalog and the daemon's catalog overlay is
  also non-empty at the moment this workspace first loads under the inverted precedence
- **THEN** the workspace's catalog is cleared to empty
- **AND** the daemon's catalog remains the effective one

#### Scenario: The migration runs once per workspace

- **WHEN** a workspace that has already run this migration loads again, and the daemon's overlays
  have changed since the migration ran
- **THEN** no further stored value is cleared on that later load

#### Scenario: A value configured after the migration is never cleared automatically

- **WHEN** an operator configures a workspace's own weaver setting after this migration has already
  run for that workspace, while the daemon's weaver overlay is filled
- **THEN** the workspace's newly configured setting is kept and governs, per
  `model-selection/daemon-overrides`'s "a filled overlay is the default a workspace uses until it
  configures its own" — this migration does not run again to clear it
