# model-selection/worker-options Specification

## Purpose
A workspace can define named worker model options, each with a when-to-use description, so that
filing a ticket can pick the fitting model from that catalog instead of always using the one
workers default.

## Requirements

### Requirement: A workspace holds a catalog of named worker model options

A workspace SHALL be able to define zero or more named worker model options. Each option SHALL
carry a kebab-case `id` unique within the catalog, a short when-to-use `description`, the
`runtime` the worker is launched with (nullable: unset means the option is not yet chosen, as
specified in `model-selection/unconfigured-option`), the `model` it is asked to use (nullable,
meaning the runtime chooses when a runtime is set), and optionally the reasoning `effort`. The
catalog SHALL live next to the two existing model settings, not instead of them. An empty catalog
SHALL be valid and SHALL be the state of a workspace that has never defined an option.

Adding, editing or removing an option SHALL take effect for the next turn of any worker whose
ticket names that option, without a daemon restart, and SHALL NOT interrupt a turn already
running. Removing an option SHALL NOT rewrite tickets that named it: those tickets fall back to
the workers setting on their next turn.

The catalog SHALL contain at most 16 options. A description SHALL be required and at most 200
characters. A duplicate `id` SHALL be rejected.

#### Scenario: An empty catalog is valid

- **WHEN** a workspace's model settings are read and no worker options have been defined
- **THEN** the catalog is returned empty, and every worker still runs on the workers setting

#### Scenario: Options are readable with id and description

- **WHEN** a workspace has defined worker options
- **THEN** each is returned with its id, description, runtime or the fact that none is chosen, model or the fact that the runtime chooses, and its effort where one is set

#### Scenario: A duplicate id is rejected

- **WHEN** an option is added or saved with an id already used in the catalog
- **THEN** the write is rejected rather than silently replacing the existing option

#### Scenario: Removing an option does not rewrite tickets

- **WHEN** an option is removed and a ticket still names that option's id
- **THEN** the ticket keeps the stored id, and its next worker turn runs on the workers setting

### Requirement: Filing a ticket can name a worker option

Creating a ticket SHALL accept a worker-option id. Assigning a ticket to a role SHALL also accept
one, but only while that ticket has no worker. Once a worker has been spawned for the ticket, create,
assign, HTTP, and the CLI SHALL NOT change the stored id. The one exception SHALL be the human
answering a usage-limit parking decision with a catalog option that was offered on that card: that
answer SHALL store that option's id on the ticket so the next turn runs on it.

When the id is supplied, it SHALL match an option in the effective catalog (the workspace's own
catalog when it is non-empty, otherwise the daemon catalog overlay if filled) at the moment of the
write; otherwise the write SHALL be rejected rather than storing an unknown id or falling back
silently. A rejection for an unknown id SHALL name the valid option ids. A request SHALL NOT accept a
raw runtime, model or effort on a ticket — only a catalog option id.

When the id is omitted, the outcome SHALL depend on who is choosing:

- On the agent-facing tools that file or route work — `weave_ticket_create`, a persistent session's
  ticket-taking tool, and role assignment that attaches a role to a ticket naming no worker option —
  the omission SHALL be refused as a `validation` error when the effective catalog holds at least one
  configured option. The refusal's message SHALL name every configured option with its description,
  so the next call can be an informed one rather than a retry with a guess.
- On the human HTTP and CLI create and assign paths, and on paths where no agent is choosing — a
  ticket filed by the system, such as the project-description scout, knowledge curation, or a
  workspace import — the omission SHALL store none, and the worker SHALL use the effective workers
  setting.
- When the effective catalog is empty, or every option in it is unconfigured, the omission SHALL
  also store none and the worker SHALL use the effective workers setting: a required field that
  cannot be satisfied would block all filing, which is worse than the default it replaces.

The same fields SHALL be available on the HTTP create and assign paths that humans use, and on the
CLI create command.

#### Scenario: Create with a known option stores it

- **WHEN** a ticket is created with a worker-option id that exists in the catalog
- **THEN** that id is stored on the ticket

#### Scenario: Create without an option uses the default

- **WHEN** a ticket is created with no worker-option id on a path that keeps the default — the human
  HTTP or CLI path, a system-filed ticket, or an empty or fully-unconfigured catalog
- **THEN** the ticket stores none, and its worker runs on the workers setting

#### Scenario: An agent create without an option is refused with the catalog

- **WHEN** `weave_ticket_create` is called with no worker-option id and the effective catalog holds
  at least one configured option
- **THEN** the call fails with a `validation` error whose message names every configured option id
  and its description
- **AND** no ticket is stored

#### Scenario: An agent create with a known option succeeds

- **WHEN** `weave_ticket_create` is called with a worker-option id that is a configured option in the
  effective catalog
- **THEN** the ticket is stored with that id

#### Scenario: An unknown option id is rejected at write time

- **WHEN** a ticket is created or assigned with a worker-option id that is not in the catalog
- **THEN** the write is rejected, no ticket is stored with that id, and the error names the valid
  option ids

#### Scenario: Assign can set the option before spawn

- **WHEN** a ticket that has no worker is assigned with a worker-option id that exists in the
  catalog
- **THEN** that id is stored on the ticket before the worker is spawned

#### Scenario: Assigning a role to a ticket with no option requires the choice

- **WHEN** `weave_ticket_assign` attaches a role to a ticket that names no worker option and the
  effective catalog holds at least one configured option
- **THEN** the call fails with a `validation` error naming the configured options, and the ticket is
  unchanged
- **AND** the same assign with a configured worker-option id succeeds

#### Scenario: A session taking a ticket requires the choice

- **WHEN** a persistent session's ticket-taking tool creates a new ticket with no worker-option id
  and the effective catalog holds at least one configured option
- **THEN** the call fails with a `validation` error naming the configured options
- **AND** the same call with a configured worker-option id succeeds

#### Scenario: An empty or fully-unconfigured catalog keeps the default

- **WHEN** an agent files a ticket with no worker-option id and the effective catalog is empty, or
  every option in it has no runtime chosen
- **THEN** the ticket is created and stores none, and its worker runs on the workers setting

#### Scenario: The option cannot be changed after spawn

- **WHEN** a ticket already has a worker and a create, assign, HTTP, or CLI request tries to
  change its worker-option id
- **THEN** the request is rejected and the stored id is left unchanged

#### Scenario: A usage-limit card can move the ticket to another catalog option

- **WHEN** a ticket already has a worker and the human answers that worker's usage-limit parking
  decision with a catalog option that was offered on the card
- **THEN** that option's id is stored on the ticket
- **AND** the existing worktree, branch and commits are kept

### Requirement: The conductor can list the catalog without guessing

A conductor-only tool SHALL list the effective workers default setting and every worker option
in the effective catalog, each option with its id, description, runtime (or the fact that none
is chosen), model and effort. The list SHALL NOT require the conductor to know the ids in
advance. Workers SHALL NOT be offered this tool. The effective catalog SHALL be the workspace's
own catalog when it is non-empty, otherwise the daemon catalog overlay when filled. The tool's
description SHALL tell the conductor not to file a ticket onto an option that has no runtime.

#### Scenario: The conductor lists options

- **WHEN** the conductor calls the tool that lists worker model options
- **THEN** the result includes the workers default and every option's id and description, and does
  not require any id as input

#### Scenario: Workers cannot list the catalog

- **WHEN** a worker calls the tool that lists worker model options
- **THEN** the call is not available to that worker

#### Scenario: Unconfigured options are listed as unset

- **WHEN** the catalog contains an option with no runtime
- **THEN** the list includes that option with no runtime chosen, rather than omitting it or showing claude

### Requirement: A worker option's model is chosen from the runtime's catalog

Wherever a worker option is added (the workspace catalog and the daemon catalog overlay use the
same editor), the model field SHALL be a picker over the models the option's chosen runtime
reports, consistent with every other model control on the page, rather than a free-text field with
nothing to check it against. The picker SHALL offer an explicit entry meaning "the runtime
chooses", distinct from naming any specific model. Changing the chosen runtime SHALL update which
models the picker offers.

Free text SHALL remain available as a secondary way to name a model the runtime's catalog does not
list, since some runtimes report an incomplete or empty catalog. It SHALL NOT be the field's
default or primary form.

#### Scenario: The model field is a picker

- **WHEN** an operator adds a worker option
- **THEN** the model field offers the chosen runtime's known models to pick from, plus an entry
  meaning the runtime chooses

#### Scenario: A model outside the catalog is still reachable

- **WHEN** the desired model is not among the runtime's known models
- **THEN** a secondary action reveals a text field to name it directly

#### Scenario: Changing the runtime changes the offered models

- **WHEN** the runtime chosen for the new option is changed
- **THEN** the model picker's list reflects the newly chosen runtime's own catalog

### Requirement: The add-option editor enforces the catalog's rules before submit

Wherever the editor for adding a worker option is shown (the workspace catalog and the daemon
catalog overlay use the same editor), it SHALL validate the entry against the same rules the
daemon enforces on the catalog — a kebab-case `id` unique within the catalog, a non-empty
description of at most 200 characters, and the catalog's 16-option cap. A violation SHALL be
shown at the offending input while the operator types, before any submit, and the action that
adds the option SHALL be unavailable while the entry would be rejected, becoming available once
it would be accepted. The editor's limits SHALL be derived from the shared schema that defines
them, not restated as independent constants in the editor, so a change to the schema's limits
changes the editor's behavior without a UI edit. The daemon's own validation SHALL remain
unchanged: a catalog write that violates the rules from any caller other than the editor SHALL
still be rejected.

#### Scenario: An over-length description is flagged at the field while typing

- **WHEN** the operator types a description one character longer than the schema currently allows
- **THEN** the description field shows the violation before any submit, and the add action is
  unavailable

#### Scenario: Correcting the entry returns the add action

- **WHEN** the operator shortens an over-length description back within the schema's limit
- **THEN** the violation clears from the field and the add action becomes available again

#### Scenario: A duplicate id is flagged before submit

- **WHEN** the operator types the id of an option already in the catalog
- **THEN** the id field shows the conflict and the add action is unavailable

#### Scenario: A non-kebab id is flagged before submit

- **WHEN** the operator types an id the schema's slug rule rejects, such as one with uppercase
  letters
- **THEN** the id field shows the violation and the add action is unavailable

#### Scenario: The catalog cap is enforced before submit

- **WHEN** the catalog already holds the maximum number of options the schema allows
- **THEN** the add action is unavailable and the cap is stated, whatever the typed entry

#### Scenario: The editor's limits follow the schema, not a restated constant

- **WHEN** the operator types a value one past the limit the schema currently defines, and a
  value exactly at it
- **THEN** the one-past value is flagged with the add action unavailable, and the at-limit value
  is accepted with the add action available — asserted by a test that computes the limit from
  the shared schema, so a schema change the editor does not follow fails that test

#### Scenario: The daemon still rejects an invalid payload from another caller

- **WHEN** a catalog write that violates the rules arrives from anything other than the editor
- **THEN** the daemon rejects it exactly as before this change

### Requirement: A worker option's thinking level follows the chosen model

Wherever a worker option is added (the workspace catalog and the daemon catalog overlay use the same editor), the thinking-level field SHALL follow the same rules as the workspace model settings: a picker constrained to the chosen model's reported efforts, hidden when that list is empty, and free text when efforts are unknown or the model is a custom id. The field SHALL stay optional. Changing the option's model or runtime SHALL update which values are offered and SHALL clear a stored effort the new model does not list.

#### Scenario: The add form offers reported efforts

- **WHEN** an operator adds a worker option and picks a model that reports a non-empty efforts list
- **THEN** the thinking-level field offers exactly those values plus unset

#### Scenario: A model with no efforts hides the field

- **WHEN** the chosen model reports an empty efforts list
- **THEN** no thinking-level picker or guessed menu is shown
- **AND** adding the option succeeds with no effort

#### Scenario: Custom or unknown model keeps free text

- **WHEN** the chosen model omits the efforts field, or is named via the free-text escape hatch
- **THEN** the thinking-level field is free text rather than a guessed list

### Requirement: An existing catalog option can be configured in place

Wherever the catalog is edited (the workspace catalog and the daemon catalog overlay use the same
editor), each existing option SHALL offer the same runtime and model controls as a new option, so an
option that has no runtime can be given one without being removed and re-added. Changing an existing
option's runtime or model SHALL persist every field the changed control does not itself edit — the
`id`, the `description`, and any stored `effort` — unchanged. A control SHALL NOT rebuild the option
from a hand-picked subset of its fields, so a field the editor does not itself surface is never
silently lost. While an option's runtime is unset, its model control SHALL be unavailable.

#### Scenario: An unconfigured row can be given a runtime

- **WHEN** the operator chooses a runtime on a catalog option that had none
- **THEN** that option is stored with the chosen runtime, the same id and description, and the
  warning that it was unconfigured no longer applies to it

#### Scenario: Model is unavailable until a runtime is chosen

- **WHEN** a catalog option has no runtime
- **THEN** its model control does not accept a choice

#### Scenario: Changing the runtime keeps the stored effort

- **WHEN** the operator changes the runtime of an existing option that has an effort stored
- **THEN** that option is persisted with the new runtime and the same id, description, model and
  effort
- **AND** the effort is not dropped because the runtime control does not edit it

### Requirement: An existing catalog option shows and can change its thinking level

Wherever the catalog is edited (the workspace catalog and the daemon catalog overlay use the same
editor), each existing option SHALL show the thinking level stored on it and SHALL offer the same
control a newly added option gets: a picker constrained to the chosen model's reported efforts plus
an explicit unset entry, hidden when that list is empty, and free text when the efforts are unknown
or the model is a custom id. Changing it SHALL persist the option's other fields (id and
description) unchanged. An option with no effort stored SHALL render as unset — the picker's unset
entry chosen, or the free-text box empty — and SHALL NOT imply an effort is set.

While the option's runtime is unset, the thinking-level control SHALL be hidden entirely, for the
same reason its model control is unavailable: there is no runtime to ask which efforts its model
accepts, and an unconfigured option cannot run a worker, so offering a value would imply a choice
that can never take effect.

#### Scenario: An option's stored effort is shown and can be changed

- **WHEN** the operator opens the catalog and an existing option's model reports a non-empty
  efforts list and the option has one of those efforts stored
- **THEN** the row's thinking-level picker shows that value
- **AND** choosing a different listed value stores it on that option, with the id and description
  unchanged

#### Scenario: The row's states match the model settings

- **WHEN** an existing option's chosen model reports a non-empty efforts list
- **THEN** the row offers a picker of exactly those values plus unset
- **AND** when it reports an empty list the row shows no thinking-level control
- **AND** when it omits the efforts, or the model is a custom id, the row offers free text

#### Scenario: An option with no effort renders as unset

- **WHEN** an existing option stores no effort
- **THEN** its thinking-level control shows no value selected and does not imply one is set

#### Scenario: An unconfigured option shows no thinking-level control

- **WHEN** an existing option has no runtime chosen
- **THEN** the row shows no thinking-level picker, hidden state or free-text box

### Requirement: A discarded thinking level is surfaced on the row

When a change to an option's model clears a stored effort that the new model does not list, the row
SHALL tell the operator that the effort was discarded and name the value, rather than resetting
with no explanation. The notice SHALL be cleared on the next change to that row's model.

#### Scenario: Changing to a model that does not list the effort announces the drop

- **WHEN** an option stores an effort and the operator changes its model to one whose reported list
  does not include that effort
- **THEN** the stored effort is cleared and the row states that it was discarded, naming the value

#### Scenario: A change that keeps the effort shows no notice

- **WHEN** the operator changes the model to one that still lists the stored effort
- **THEN** the effort is kept and no discard notice is shown

### Requirement: Thinking-level states come from one shared rule

Every thinking-level control in the settings page — the conductor and workers settings, the daemon
overlays, the add-option form, and an existing catalog row — SHALL derive its picker, hidden or
free-text state from one shared rule that maps a model's reported efforts and any stored effort onto
exactly one of those states. No caller SHALL carry its own copy of that derivation, so a change to
the rule reaches every control together.

#### Scenario: Every control agrees on the same model

- **WHEN** the same model and stored effort are presented to the settings control, the add form and
  an existing row
- **THEN** all three resolve to the same picker, hidden or free-text state

### Requirement: An existing catalog option's description can be edited in place

Wherever the catalog is edited (the workspace catalog and the daemon catalog overlay use the same
editor), each existing option SHALL offer a field showing that option's stored when-to-use
`description`, editable in place and committed through the catalog's existing save path. Committing
SHALL persist the option's other fields — its `id`, `runtime`, `model` and `effort` — unchanged.

The option's `id` SHALL NOT be editable: the row SHALL NOT render a control that changes it, and no
description edit SHALL alter it.

The character limit the shared schema defines for a description SHALL be visible while editing, and a
description the schema rejects (empty, or longer than the limit) SHALL be refused with the reason
stated before the catalog is written, rather than silently truncated or persisted. The saved
description SHALL be what the conductor's catalog-listing tool subsequently returns. Editing a
description SHALL affect future routing only: it SHALL NOT rewrite any `workerModelId` already
recorded on a ticket.

#### Scenario: An existing option's description is edited and saved

- **WHEN** the operator changes an existing option's description and commits it
- **THEN** the catalog is saved with the new description for that option
- **AND** the option's id, runtime, model and effort are stored unchanged

#### Scenario: The id is not editable through the description edit

- **WHEN** the operator edits an option's description
- **THEN** the row offers no control that changes that option's id
- **AND** the saved option keeps the same id

#### Scenario: The character limit is visible and an over-length description is refused

- **WHEN** the operator edits a description beyond the character limit the shared schema defines
- **THEN** the row shows the limit and the violation while typing, before any save
- **AND** committing is refused with the reason stated, rather than the text being truncated or the
  catalog being written with an invalid description

#### Scenario: The conductor sees the edited description

- **WHEN** an option's description is edited and saved
- **THEN** the tool that lists worker model options subsequently returns the new description for that
  option

#### Scenario: A description edit does not disturb the option's runtime or model

- **WHEN** the operator edits an option's description and commits it without touching the runtime or
  model controls
- **THEN** the option's runtime, model and effort are stored exactly as before

#### Scenario: A runtime or model edit does not disturb the description

- **WHEN** the operator changes an option's runtime or model
- **THEN** the option's stored description is unchanged
