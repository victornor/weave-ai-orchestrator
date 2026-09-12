# model-selection/daemon-overrides Specification

## Purpose
Optional daemon-level overlays for the conductor setting, the workers default, and the named
worker-options catalog, so every workspace on the daemon can share one filled value without
losing per-workspace settings when the overlay is empty.

## Requirements

### Requirement: The daemon holds three independent optional model overlays

The daemon SHALL be able to hold an overlay for each of: the conductor setting, the workers
default setting, and the named worker-options catalog. Each overlay SHALL be independent of
the others. A conductor or workers overlay SHALL be a full setting (runtime, model or the
fact that the runtime chooses, optional effort), not a model id alone. A catalog overlay
SHALL be a list of named options, each with id, description, runtime (nullable: unset means
not yet chosen), model and optional effort, using the same shape and limits as the workspace
catalog.

An overlay SHALL be empty until it is filled. Empty SHALL mean: the conductor or
workers overlay is absent or null; the catalog overlay is absent, null, or an empty list.
The one exception is a daemon config directory that has no `daemon.yaml` yet: starting the
daemon SHALL write that file with the catalog overlay already filled, as specified in
`model-selection/fresh-install-defaults`. A `daemon.yaml` that already exists is not that
exception.

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

### Requirement: The Models page states inherit-or-override explicitly for each overlay row

For each of the conductor overlay row and the workers overlay row, the daemon Models page SHALL
present an explicit choice between providing no daemon-level default for that control and
providing one, rather than inferring which is in force from which buttons happen to be shown. The
current choice SHALL be readable without depending on whether the operator has changed anything
else on the row.

While a row provides no default, its runtime and model controls SHALL show the value that row is
currently previewing and SHALL NOT accept a change: opening or changing them SHALL have no effect
on the overlay. Interacting with the explicit choice itself is the only way to change which state
a row is in.

A row that provides a default SHALL make clear that the value it holds governs only a workspace
that has not configured its own value for that control, never every workspace unconditionally.

#### Scenario: Each row states its own state

- **WHEN** the daemon Models page is opened
- **THEN** the conductor row and the workers row each show, in a form that does not require
  comparing which buttons are present, whether they currently provide a default or not

#### Scenario: Opening or changing an inheriting row's fields does nothing

- **WHEN** a row provides no default and its runtime or model control is opened or changed
- **THEN** no overlay is created and no write is made to the daemon

#### Scenario: Choosing to override is the deliberate act that creates the overlay

- **WHEN** the operator chooses to provide a default for a row that had none
- **THEN** an overlay is created for that row, seeded from the value it was previewing

#### Scenario: Choosing to inherit is a normal option, not a special-cased button

- **WHEN** a row currently provides a default
- **THEN** returning it to no default is available as one of the row's normal choices, not only
  through a button that appears solely because an overlay exists

#### Scenario: A provided default states that it is not unconditional

- **WHEN** a row provides a default
- **THEN** the page's copy for that row does not claim the value applies to every workspace
  unconditionally

### Requirement: An inheriting row shows the value it inherits

While a row is inheriting, the Models page SHALL show the effective value the row currently
resolves to — the runtime and the model — rather than leaving the row blank or showing a value
unrelated to what actually governs turns.

Because the overlay is shared by every workspace on the daemon while each workspace may hold a
different setting, the value shown SHALL be stated as belonging to the workspace currently being
viewed, not asserted as the value every workspace resolves to.

#### Scenario: The inherited value is shown, not blank

- **WHEN** a row is inheriting
- **THEN** the runtime and the model it currently resolves to for the workspace being viewed are
  visible on the page

#### Scenario: The shown value is not claimed to be universal

- **WHEN** a row is inheriting and two workspaces on the same daemon hold different settings for
  that control
- **THEN** the page does not present the shown value as the one every workspace uses

### Requirement: Daemon model overlays offer thinking level next to the model

The daemon Models page SHALL offer the same thinking-level control as the workspace model settings on each conductor and workers overlay row, and on the daemon worker-options add form, constrained to what the chosen model reports. While a row is inheriting, that control SHALL be disabled with the rest of the row and SHALL NOT create an overlay.

#### Scenario: An overriding row can set thinking level

- **WHEN** a daemon Models conductor or workers row is overriding and the chosen model reports a non-empty efforts list
- **THEN** a thinking-level control next to that model offers exactly those values plus unset

#### Scenario: An inheriting row's thinking level is inert

- **WHEN** a daemon Models row is inheriting
- **THEN** opening or changing its thinking-level control does not create an overlay and does not write to the daemon

### Requirement: A filled overlay is the default a workspace uses until it configures its own

When a daemon overlay is filled for a control — the conductor setting, the workers setting, or the
worker-options catalog — a workspace SHALL use that overlay as the effective value for that
control **only while the workspace itself has not configured its own value** for that control. A
workspace that has configured its own value for a control SHALL use that value for every turn,
every read, and every ticket write that names a catalog option, regardless of whether a daemon
overlay is filled for it, and regardless of what that overlay holds.

Filling, changing, or clearing a daemon overlay SHALL NOT change what a workspace that has
configured its own value for that control resolves to, and SHALL NOT rewrite that workspace's
stored setting. The matching workspace Settings control SHALL remain enabled for every workspace
at all times and SHALL accept and persist a change regardless of the daemon overlay's state.

When a daemon overlay for a control is empty (absent, null, or an empty catalog), a workspace's
effective value for that control SHALL be its own stored setting when it has configured one,
otherwise the schema's built-in default (`claude`, no model chosen, for the two settings; an
empty catalog for worker options).

#### Scenario: Filled conductor overlay governs a workspace with no conductor setting of its own

- **WHEN** the daemon conductor overlay is filled and a workspace that has not configured its own
  conductor setting takes a conductor turn
- **THEN** that turn is launched on the overlay's runtime, model and effort

#### Scenario: A configured workspace setting wins over a filled overlay

- **WHEN** the daemon conductor overlay is filled and a workspace has configured its own conductor
  setting, and that workspace's conductor takes a turn
- **THEN** that turn is launched on the workspace's own conductor setting, not the daemon overlay

#### Scenario: Filled workers overlay governs a worker with no live option and no workspace setting

- **WHEN** the daemon workers overlay is filled, a worker's ticket names no option (or one no
  longer in the effective catalog), and that worker's workspace has not configured its own workers
  setting
- **THEN** that turn is launched on the overlay's runtime, model and effort

#### Scenario: Filled catalog overlay is the default for a workspace with an empty catalog

- **WHEN** the daemon catalog overlay is filled, a workspace has defined no worker options of its
  own, and a ticket in that workspace is created with a worker-option id
- **THEN** the id is accepted only when it is in the daemon catalog, and the conductor's catalog
  list for that workspace returns the daemon catalog

#### Scenario: A workspace's own catalog wins over a filled daemon catalog overlay

- **WHEN** the daemon catalog overlay is filled and a workspace has defined its own non-empty
  worker-options catalog
- **THEN** a ticket in that workspace naming a worker-option id is validated and resolved against
  the workspace's own catalog, not the daemon's

#### Scenario: Workspace Settings stays editable regardless of a filled overlay

- **WHEN** the daemon conductor overlay is filled and the operator opens a workspace's model
  settings
- **THEN** the conductor control is shown enabled, and a change to it is accepted, persisted to
  that workspace's stored setting, and takes effect on that agent's next turn

#### Scenario: Clearing an overlay does not affect a workspace that already has its own setting

- **WHEN** a daemon conductor overlay is cleared after having been filled, and a workspace had
  configured its own conductor setting the entire time
- **THEN** that workspace's conductor turns are unaffected — they were already running on its own
  setting, never on the overlay

#### Scenario: Clearing an overlay changes only a workspace that had none of its own

- **WHEN** a daemon workers overlay is cleared and a workspace has never configured its own workers
  setting
- **THEN** that workspace's next worker turn (with no live option) falls back to the schema
  default rather than the cleared overlay
