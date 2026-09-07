# model-selection/settings-migration Specification

## Purpose
TBD - created by archiving change vs-77-model-selection-is-exactly-two-per-works. Update Purpose after archive.

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
