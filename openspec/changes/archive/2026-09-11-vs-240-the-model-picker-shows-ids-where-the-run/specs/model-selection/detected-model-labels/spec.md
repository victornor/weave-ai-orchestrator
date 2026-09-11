## Purpose

Ensures a detected model's display label reflects the coding-CLI runtime's own reported name
whenever the adapter's existing discovery output carries one, and that a human choosing a model
can always see both that name and the id that actually gets written to config.

## ADDED Requirements

### Requirement: A detected model's label comes from the runtime's own reported name

When a runtime adapter's `listModels()` discovery already parses output that includes a
human-readable name for a model (a field such as a JSON `name`, or a display name printed
alongside the id in the CLI's own text output), the returned `RuntimeModel.label` SHALL be that
name, not a value invented purely from the id. This SHALL use only output the adapter already
reads to build the model list — no additional process launch, cache read, or registry fetch may
be introduced to obtain a name.

A model line that carries no such name (the id alone, with nothing else to go on) SHALL still be
returned, labelled by its id as before. A static fallback catalogue with no better name available
SHALL continue to label itself by id (or by whatever hand-maintained label it already carries) —
this requirement governs only labels sourced from a runtime's live discovery output.

#### Scenario: A detected model reports a name distinct from its id

- **WHEN** a runtime's discovery output includes, for one model, both an id and a separate
  human-readable name for that same model
- **THEN** `listModels()` returns that model with `label` set to the reported name
- **AND** `id` is unchanged

#### Scenario: The newest-looking id is not mistaken for the oldest

- **WHEN** discovery output reports id `deepseek-flash` with name "DeepSeek V4.1 Flash" alongside
  id `deepseek-v4-flash` with name "DeepSeek V4 Flash"
- **THEN** the two returned models carry those two distinct labels
- **AND** neither label is the bare id

#### Scenario: A model line with no reported name still appears

- **WHEN** discovery output lists a model id with no accompanying name
- **THEN** that model is still returned
- **AND** its `label` is its `id`

#### Scenario: No extra probe is introduced to find a name

- **WHEN** `listModels()` runs for any runtime
- **THEN** the number of CLI invocations, cache reads, or network calls it makes is unchanged
  from before this requirement existed

### Requirement: The model picker shows both the name and the id

A UI control that lets a human choose a model from a runtime's catalogue SHALL present, for each
option, both its `label` and its `id` when they differ, so the value that is actually written to
config is never hidden behind a friendlier name. When a model's `label` equals its `id` (no
better name was available), the option MAY show the id alone rather than a redundant repetition.

#### Scenario: A model with a distinct name shows both

- **WHEN** a model's `label` is "DeepSeek V4.1 Flash" and its `id` is `deepseek-flash`
- **THEN** the rendered option text includes both "DeepSeek V4.1 Flash" and `deepseek-flash`

#### Scenario: A model with no distinct name shows the id once

- **WHEN** a model's `label` equals its `id`
- **THEN** the rendered option text shows that id once, not doubled
