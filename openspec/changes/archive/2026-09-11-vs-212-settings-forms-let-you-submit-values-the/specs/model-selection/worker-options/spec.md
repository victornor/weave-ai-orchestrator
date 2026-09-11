## Purpose

Defines how the add-option editor — the form used to add a worker model option, mounted by both
the workspace Models section and the daemon overlay — enforces the catalog's rules before the
operator can submit, using the same shared schema the daemon validates with.

## ADDED Requirements

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
