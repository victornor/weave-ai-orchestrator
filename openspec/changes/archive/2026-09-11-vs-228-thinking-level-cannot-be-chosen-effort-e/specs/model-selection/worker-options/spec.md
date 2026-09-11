## ADDED Requirements

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
