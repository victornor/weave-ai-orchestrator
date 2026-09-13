# model-selection/settings-migration Specification

## Purpose
Defines how a workspace that predates the two-setting model choice arrives at it without a human:
the daemon derives the settings from what was in force, records how it decided, asks rather than
guesses when a workspace's roles disagreed, and clears a workspace value a filled daemon overlay was
masking.

## Requirements

### Requirement: An existing workspace arrives at the two settings by itself

A workspace configured before the two settings existed SHALL be given both of them the first time
it is loaded, derived from what it was already running on, without the operator having to write
them. A workspace that already has them SHALL be left untouched.

The conductor setting SHALL be derived from the workspace's existing conductor configuration. The
workers setting SHALL be derived from the runtime and model the workspace's roles were actually
using, and where there are no roles, from the workspace's previous default.

The derived settings SHALL be written back to the workspace's configuration so that the derivation
happens once, and the configuration that follows SHALL no longer carry the settings it replaced.

#### Scenario: A single-runtime workspace

- **WHEN** a workspace whose roles all used one runtime and model is loaded for the first time after
  the change
- **THEN** its workers setting holds that runtime and model, its conductor setting holds what its
  conductor was configured with, and both are written to its configuration

#### Scenario: A workspace with no roles

- **WHEN** a workspace that has hired no roles is loaded
- **THEN** its workers setting is derived from the workspace's previous default runtime and model

#### Scenario: The derivation happens once

- **WHEN** a workspace that has already been given both settings is loaded again
- **THEN** neither setting is recomputed and the configuration is not rewritten

### Requirement: The derivation is recorded so it can be checked

The system SHALL record what it derived and why: the two settings it chose, the runtimes it found
in use, and which rule produced the workers setting. The record SHALL be written where an operator
can read it after the fact, and SHALL NOT require reading the database.

#### Scenario: The choice is explained

- **WHEN** a workspace is migrated to the two settings
- **THEN** the system records the settings it chose, the runtimes it found, and the reason the
  workers setting holds what it holds

### Requirement: A workspace whose roles disagreed is asked, not guessed

Where the roles of a workspace used more than one runtime, the system SHALL NOT settle the workers
setting silently. It SHALL write the most used of them so that turns can still run, and SHALL raise
a decision owned by the human asking which runtime the workers setting should hold, offering each
runtime the roles used and recommending the one it wrote.

At most one such decision SHALL be open for a workspace: reloading or restarting the daemon SHALL
NOT raise a second. Answering it SHALL write the chosen runtime to the workers setting, and the
question SHALL NOT be asked again.

#### Scenario: Mixed runtimes raise a question

- **WHEN** a workspace whose roles used more than one runtime is migrated
- **THEN** the workers setting holds the most used of them, and a decision owned by the human asks
  which runtime the workers setting should hold, offering each runtime the roles used

#### Scenario: A restart does not ask twice

- **WHEN** the daemon is restarted while that decision is still open
- **THEN** the same decision is still the only one open, and no second one is raised

#### Scenario: Answering settles it

- **WHEN** the human chooses a runtime
- **THEN** the workers setting holds it and the question is not asked again on a later load

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
