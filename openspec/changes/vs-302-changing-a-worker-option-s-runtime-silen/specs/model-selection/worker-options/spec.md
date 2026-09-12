## MODIFIED Requirements

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
