# model-selection/effort-catalogue Specification

## Purpose
Each runtime's model catalogue carries the thinking/effort values that model actually accepts, discovered by the adapter the same way it lists models, so clients can offer a real picker instead of a guessed menu or an invisible free-text string.

## Requirements

### Requirement: A listed model carries the efforts it accepts

Every model a runtime returns from its model list SHALL be able to carry the thinking or effort values that model accepts. Those values SHALL be populated by that runtime's adapter, from the same discovery path that produced the model entry, never from a client-side or shared hardcoded universe.

The catalogue SHALL distinguish three states:

- a non-empty list: the model accepts exactly those values
- an empty list: the adapter established that this model takes no separate effort value
- the field omitted: the adapter could not establish what the model accepts

Whether the model row itself was detected from the runtime or assumed from a static table SHALL remain visible via the existing model `source` field. Efforts on a row SHALL come from that same path. A detected catalogue SHALL NOT be paired with a guessed effort menu.

#### Scenario: Detected models include their reported efforts

- **WHEN** a runtime lists models by querying the installed CLI and a listed model reports a set of thinking or effort values
- **THEN** that model is returned with those values and with `source` detected

#### Scenario: A model known to take no effort reports an empty list

- **WHEN** the adapter has established that a model does not consume a separate effort or thinking value
- **THEN** that model is returned with an empty efforts list rather than a guessed menu

#### Scenario: Unknown efforts are omitted, not invented

- **WHEN** the adapter cannot establish which values a model accepts
- **THEN** the efforts field is omitted on that model
- **AND** no client is given a list to present as authoritative

#### Scenario: Static catalogue honesty

- **WHEN** a runtime cannot query a live list and returns its maintained static table
- **THEN** each row's `source` is static
- **AND** any efforts on those rows come from that same table, not from a separate guessed enum applied to every model

### Requirement: Effort still reaches the CLI unchanged

When a turn is launched with an effort value set, the adapter SHALL pass that value to the coding CLI exactly as it does today. This change SHALL NOT alter flag names, config keys, or when the flag is omitted.

#### Scenario: A set effort is still forwarded

- **WHEN** a turn is launched with effort set to a non-empty string on a runtime that already forwards effort
- **THEN** the child invocation includes that value on the same flag or config key it uses today

#### Scenario: Unset effort stays omitted

- **WHEN** a turn is launched with no effort set
- **THEN** the child invocation does not gain an effort flag

### Requirement: A model with no efforts remains selectable

A model that reports no efforts, or omits the field, SHALL remain fully usable. Selecting it SHALL NOT require an effort value. An existing setting that has no effort SHALL remain valid.

#### Scenario: Selecting a model that reports none

- **WHEN** the operator selects a model whose efforts list is empty
- **THEN** the model is stored
- **AND** no effort value is required

#### Scenario: Selecting a model whose efforts are unknown

- **WHEN** the operator selects a model that omits the efforts field
- **THEN** the model is stored
- **AND** an effort value is not required
