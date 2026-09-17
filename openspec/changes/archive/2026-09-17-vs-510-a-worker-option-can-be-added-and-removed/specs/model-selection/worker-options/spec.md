## MODIFIED Requirements

### Requirement: An existing catalog option can be configured in place

Wherever the catalog is edited (the workspace catalog and the daemon catalog overlay use the same
editor), each existing option SHALL offer the same runtime, model, effort and runtime-specific
option controls as a new option. An edit SHALL retain the option's stable `id` and every field not
being changed, including its description and any stored values in controls not surfaced by the
current interaction. A control SHALL NOT rebuild the option from a hand-picked subset of its
fields, so a field the editor does not itself surface is never silently lost.

An edit SHALL pass the same validation as adding an option, including the catalog schema, the
catalog's uniqueness and size rules, and validation that a selected runtime is configured and
available. An invalid edit SHALL be rejected with an error naming the invalid value or rule and
the previously stored option SHALL remain unchanged. While an option's runtime is unset, its
model, effort and runtime-specific option controls SHALL be unavailable.

Edits SHALL affect resolution for a ticket's next worker spawn without restarting the daemon or
interrupting a turn already running. A worker turn that has already resolved the option SHALL
continue using its old runtime, model, effort and options; a later turn SHALL resolve the current
catalog entry. Editing an option SHALL NOT rewrite any ticket's stored `workerModelId`.

#### Scenario: An unconfigured row can be given a runtime

- **WHEN** the operator chooses an available runtime on a catalog option that had none
- **THEN** that option is stored with the chosen runtime, the same id and description, and the
  warning that it was unconfigured no longer applies to it

#### Scenario: Model is unavailable until a runtime is chosen

- **WHEN** a catalog option has no runtime
- **THEN** its model, effort and runtime-specific option controls do not accept a choice

#### Scenario: Changing the runtime keeps fields the runtime control does not edit

- **WHEN** the operator changes the runtime of an existing option that has a model, effort or
  runtime-specific options stored
- **THEN** that option is persisted with the new runtime and the same id, description, model,
  effort and runtime-specific options

#### Scenario: Changing the runtime keeps the stored effort

- **WHEN** the operator changes the runtime of an existing option that has an effort stored
- **THEN** that option is persisted with the new runtime and the same id, description, model and
  effort
- **AND** the effort is not dropped because the runtime control does not edit it

#### Scenario: An edit keeps the option id

- **WHEN** the operator changes an existing option's model
- **THEN** the option is saved in place and its id remains unchanged

#### Scenario: An unavailable runtime is rejected without mutation

- **WHEN** an edit selects a runtime that is not configured or available
- **THEN** the edit is refused with an error naming the runtime
- **AND** the option retains its previous runtime, model, effort, options, description and id

#### Scenario: Invalid edits leave the catalog unchanged

- **WHEN** an edit violates any catalog validation rule
- **THEN** the edit is refused with the violated rule stated
- **AND** no field of the stored option changes

#### Scenario: An edit applies to the next spawn only

- **WHEN** an option is edited while a worker turn using the old option settings is running
- **THEN** that running turn continues with the old settings
- **AND** a later worker spawn for a ticket naming the same option resolves the edited settings
- **AND** the ticket's stored worker-option id is not rewritten
