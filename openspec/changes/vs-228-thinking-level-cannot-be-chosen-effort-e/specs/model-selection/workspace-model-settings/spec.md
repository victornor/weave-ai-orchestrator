## ADDED Requirements

### Requirement: Thinking level is choosable next to the model

Wherever the web app presents a workspace conductor or workers model setting, it SHALL offer a thinking-level control next to that setting's model, driven by the efforts the chosen model reports:

- a non-empty list SHALL be offered as a picker constrained to those values, plus an explicit entry meaning unset
- an empty list SHALL hide the control rather than offering a guessed menu
- an omitted list, or a model id the catalogue does not contain, SHALL offer free text rather than a guessed menu

The control SHALL stay optional. Changing the chosen model SHALL clear a stored effort that is not in the new model's reported list. A model reporting no efforts SHALL remain selectable with none set.

The command line already accepts `--effort` as free text and SHALL keep doing so.

#### Scenario: A model that reports efforts gets a picker

- **WHEN** the operator opens the workspace's model settings and the chosen model reports a non-empty efforts list
- **THEN** a thinking-level control next to that model offers exactly those values plus unset

#### Scenario: A model that reports none hides the control

- **WHEN** the chosen model reports an empty efforts list
- **THEN** no thinking-level picker or guessed menu is shown
- **AND** the setting remains valid with no effort

#### Scenario: Unknown efforts fall back to free text

- **WHEN** the chosen model omits the efforts field, or the stored model id is not among the runtime's listed models
- **THEN** the thinking-level control is free text rather than a guessed list

#### Scenario: Changing model drops a stale effort

- **WHEN** the operator changes the model to one whose reported list does not include the currently stored effort
- **THEN** the stored effort is cleared rather than kept against the new model

#### Scenario: Effort stays optional

- **WHEN** the operator picks a model that reports efforts and leaves thinking level unset
- **THEN** the setting is stored with no effort
- **AND** the next turn of that agent launches without an effort flag
