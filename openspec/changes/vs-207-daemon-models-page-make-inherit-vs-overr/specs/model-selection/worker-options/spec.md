## ADDED Requirements

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
