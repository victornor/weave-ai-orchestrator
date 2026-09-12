## REMOVED Requirements

### Requirement: A filled overlay is the effective value for every workspace

**Reason**: This is the precedence captain asked to invert (VS-284): a filled daemon overlay no
longer forces every workspace, and a workspace's own control is never disabled by one. Its
premise — that a filled overlay is *the* effective value regardless of what the workspace holds —
is exactly what this change reverses.

**Migration**: Replaced in full by "A filled overlay is the default a workspace uses until it
configures its own" below, which keeps the shape of every overlay (independent, per-control,
still filled/cleared the same way) and keeps "the workspace's stored setting SHALL NOT be
rewritten" verbatim, but makes the workspace's own configured value win over a filled overlay
rather than the reverse. No stored shape changes: a daemon overlay that was filled stays filled,
in the same shape, after this change ships.

### Requirement: An empty overlay leaves that control on the workspace

**Reason**: Folded into "A filled overlay is the default a workspace uses until it configures its
own" — under the inverted precedence, "what happens when the overlay is empty" and "what happens
when the workspace has its own value" are the same rule stated from two ends, so one requirement
now covers both instead of two requirements that each described one half of the old, one-directional
precedence.

**Migration**: The guarantee that an empty overlay leaves a workspace on its own stored setting
(or the schema default, when it has none) is preserved verbatim in the replacement requirement's
scenarios; nothing about the empty-overlay case changes behaviour.

## ADDED Requirements

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

## MODIFIED Requirements

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
