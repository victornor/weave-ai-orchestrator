## Purpose

Optional daemon-level overlays for the conductor setting, the workers default, and the named
worker-options catalog, so every workspace on the daemon can share one filled value without
losing per-workspace settings when the overlay is empty.

## ADDED Requirements

### Requirement: The daemon holds three independent optional model overlays

The daemon SHALL be able to hold an overlay for each of: the conductor setting, the workers
default setting, and the named worker-options catalog. Each overlay SHALL be independent of
the others. A conductor or workers overlay SHALL be a full setting (runtime, model or the
fact that the runtime chooses, optional effort), not a model id alone. A catalog overlay
SHALL be a list of named options, each with id, description, runtime, model and optional
effort, using the same shape and limits as the workspace catalog.

An overlay SHALL be empty until the operator fills it. Empty SHALL mean: the conductor or
workers overlay is absent or null; the catalog overlay is absent, null, or an empty list.

#### Scenario: All overlays empty is valid

- **WHEN** the daemon's model overlays are read and none have been filled
- **THEN** each overlay is returned empty, and every workspace still uses its own model
  settings

#### Scenario: Overlays can be filled independently

- **WHEN** only the daemon conductor overlay is filled
- **THEN** the workers overlay and the catalog overlay remain empty

#### Scenario: A filled overlay is a full setting

- **WHEN** the operator fills the daemon conductor overlay
- **THEN** it stores a runtime, a model or the fact that the runtime chooses, and an effort
  where one is set

### Requirement: A filled overlay is the effective value for every workspace

When a daemon overlay is filled, every workspace on that daemon SHALL use that overlay as the
effective value for that control: turns, reads of the model settings, the conductor's catalog
list, and ticket writes that name a worker-option id. The matching workspace Settings control
SHALL be shown disabled (greyed out) and SHALL NOT accept a change. The workspace's stored
setting SHALL NOT be rewritten.

#### Scenario: Filled conductor overlay governs every workspace

- **WHEN** the daemon conductor overlay is filled and a workspace's conductor takes a turn
- **THEN** that turn is launched on the overlay's runtime, model and effort, not the
  workspace's stored conductor setting

#### Scenario: Filled workers overlay governs workers without a live option

- **WHEN** the daemon workers overlay is filled and a worker's ticket names no option, or
  names an option that is not in the effective catalog
- **THEN** that turn is launched on the overlay's runtime, model and effort

#### Scenario: Filled catalog overlay is what tickets may name

- **WHEN** the daemon catalog overlay is filled and a ticket is created with a worker-option
  id
- **THEN** the id is accepted only when it is in the daemon catalog, and the conductor's
  catalog list returns the daemon catalog

#### Scenario: Workspace Settings cannot change a filled overlay's control

- **WHEN** the daemon conductor overlay is filled and the operator opens a workspace's model
  settings
- **THEN** the conductor control is shown disabled, and a write that targets it does not
  change what turns run on or the workspace's stored conductor setting

### Requirement: An empty overlay leaves that control on the workspace

When a daemon overlay is empty, that control SHALL behave as it does today: the workspace's
stored setting or catalog is the effective value, and workspace Settings can change it.

Clearing a previously filled overlay SHALL restore that behaviour, including the workspace
values that were stored while the overlay was in force.

#### Scenario: Empty overlay uses the workspace setting

- **WHEN** the daemon workers overlay is empty and a worker's turn is launched with no live
  option
- **THEN** it is launched on that workspace's stored workers setting

#### Scenario: Clearing an overlay restores the workspace setting

- **WHEN** a daemon conductor overlay is cleared after it had been filled
- **THEN** each workspace's conductor next turn runs on that workspace's stored conductor
  setting, and the workspace conductor control is enabled again

### Requirement: An overlay change applies on the next turn without a restart

Filling, editing or clearing a daemon overlay SHALL take effect for the next turn any
affected agent runs, without a daemon restart, and SHALL NOT interrupt a turn already
running. Changing only the model or effort SHALL NOT retire a session; changing the runtime
SHALL, as already specified for workspace settings.

#### Scenario: Filling an overlay changes the next turn

- **WHEN** the daemon workers overlay is filled while a worker turn is running
- **THEN** the running turn is not interrupted, and that worker's next turn runs on the
  overlay

#### Scenario: The same overlay is visible from every workspace

- **WHEN** a daemon overlay is filled while viewing one workspace and model settings are then
  read from another workspace
- **THEN** the overlay is the effective value there too, without reloading the app
