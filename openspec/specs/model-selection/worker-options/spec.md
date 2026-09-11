# model-selection/worker-options Specification

## Purpose
A workspace can define named worker model options, each with a when-to-use description, so that
filing a ticket can pick the fitting model from that catalog instead of always using the one
workers default.

## Requirements

### Requirement: A workspace holds a catalog of named worker model options

A workspace SHALL be able to define zero or more named worker model options. Each option SHALL
carry a kebab-case `id` unique within the catalog, a short when-to-use `description`, the
`runtime` the worker is launched with, the `model` it is asked to use (nullable, meaning the
runtime chooses), and optionally the reasoning `effort`. The catalog SHALL live next to the two
existing model settings, not instead of them. An empty catalog SHALL be valid and SHALL be the
state of a workspace that has never defined an option.

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
- **THEN** each is returned with its id, description, runtime, model or the fact that the runtime
  chooses, and its effort where one is set

#### Scenario: A duplicate id is rejected

- **WHEN** an option is added or saved with an id already used in the catalog
- **THEN** the write is rejected rather than silently replacing the existing option

#### Scenario: Removing an option does not rewrite tickets

- **WHEN** an option is removed and a ticket still names that option's id
- **THEN** the ticket keeps the stored id, and its next worker turn runs on the workers setting

### Requirement: Filing a ticket can name a worker option

Creating a ticket SHALL accept an optional worker-option id. Assigning a ticket to a role SHALL
also accept one, but only while that ticket has no worker. Once a worker has been spawned for
the ticket, the stored id SHALL NOT be changed by create, assign, or any other request.

When the id is omitted, the ticket SHALL store none and its worker SHALL use the effective
workers setting. When the id is supplied, it SHALL match an option in the effective catalog
(the daemon catalog overlay if filled, otherwise the workspace catalog) at the moment of the
write; otherwise the write SHALL be rejected rather than storing an unknown id or falling back
silently. A request SHALL NOT accept a raw runtime, model or effort on a ticket — only a
catalog option id.

The same fields SHALL be available on the HTTP create and assign paths that humans use, and on
the CLI create command.

#### Scenario: Create with a known option stores it

- **WHEN** a ticket is created with a worker-option id that exists in the catalog
- **THEN** that id is stored on the ticket

#### Scenario: Create without an option uses the default

- **WHEN** a ticket is created with no worker-option id
- **THEN** the ticket stores none, and its worker runs on the workers setting

#### Scenario: An unknown option id is rejected at write time

- **WHEN** a ticket is created or assigned with a worker-option id that is not in the catalog
- **THEN** the write is rejected and no ticket is stored with that id

#### Scenario: Assign can set the option before spawn

- **WHEN** a ticket that has no worker is assigned with a worker-option id that exists in the
  catalog
- **THEN** that id is stored on the ticket before the worker is spawned

#### Scenario: The option cannot be changed after spawn

- **WHEN** a ticket already has a worker and a request tries to change its worker-option id
- **THEN** the request is rejected and the stored id is left unchanged

### Requirement: The conductor can list the catalog without guessing

A conductor-only tool SHALL list the effective workers default setting and every worker option
in the effective catalog, each option with its id, description, runtime, model and effort. The
list SHALL NOT require the conductor to know the ids in advance. Workers SHALL NOT be offered
this tool. The effective catalog SHALL be the daemon catalog overlay when that overlay is
filled, otherwise the workspace catalog.

#### Scenario: The conductor lists options

- **WHEN** the conductor calls the tool that lists worker model options
- **THEN** the result includes the workers default and every option's id and description, and does
  not require any id as input

#### Scenario: Workers cannot list the catalog

- **WHEN** a worker calls the tool that lists worker model options
- **THEN** the call is not available to that worker

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
