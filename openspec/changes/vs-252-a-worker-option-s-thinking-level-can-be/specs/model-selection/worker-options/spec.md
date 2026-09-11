# model-selection/worker-options

## ADDED Requirements

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
