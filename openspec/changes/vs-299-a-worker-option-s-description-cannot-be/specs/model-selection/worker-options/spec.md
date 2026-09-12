## ADDED Requirements

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
