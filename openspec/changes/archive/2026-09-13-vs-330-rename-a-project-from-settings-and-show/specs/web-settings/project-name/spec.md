## Purpose

Reading and changing a project's display name from the Settings Projects section, including
clearing it so the project falls back to its slug.

## ADDED Requirements

### Requirement: A project's display name is editable from the Projects section

Each active project row in the Settings Projects section SHALL carry an editable display-name field,
following the Settings commit-field contract (`web-settings/field-commit`). The field SHALL show the
project's current name. Committing a non-empty value SHALL send `PATCH /api/w/:ws/projects/:id` with
`{ name: <trimmed value> }`; the request body SHALL carry only `name` and SHALL NOT restate the
project's other fields, policies, setup command, `maxWorkers` or `landingBranch`. A subsequent read
of the project SHALL show the new name, and the label everywhere SHALL become that name.

#### Scenario: Renaming commits a PATCH with the name

- **WHEN** the operator edits a project's display-name field to `Weave AI` and commits it
- **THEN** a PATCH is sent to that project carrying `{ name: 'Weave AI' }`, and the project read
  back afterwards has that name

#### Scenario: Reading the section shows the current name

- **WHEN** the operator opens the Projects section
- **THEN** each active project row shows that project's current display name

#### Scenario: A rename does not restate the project's other fields

- **WHEN** the operator renames a project that has policies, a setup command, `maxWorkers` and a
  `landingBranch` set
- **THEN** the request body contains none of those fields, only `name`

### Requirement: Clearing the name falls back to the slug

Committing an empty value — or one that is empty once trimmed — SHALL clear the project's display
name: the request SHALL carry the empty value as the clear sentinel (the same convention
`landingBranch` uses), and the project SHALL then be named by its slug on every surface, with no
empty or whitespace label. Clearing SHALL NOT be sent as an omission that leaves the previous name
in place.

#### Scenario: Clearing the name falls back to the slug

- **WHEN** the operator clears a project's display-name field and commits it
- **THEN** the project's name is cleared, and the project is shown by its slug afterwards

#### Scenario: A whitespace-only commit clears as well

- **WHEN** the operator commits a display name that is only spaces
- **THEN** the name is cleared and the project falls back to its slug

### Requirement: The name field follows the Settings commit-field contract

The display-name field SHALL use the same commit behaviour as the other Settings fields: `Enter`
commits without requiring blur, an explicit save action is available while the draft differs from
the saved value, the field shows unsaved / saving / saved / failed state beside it, a rejected save
keeps the typed draft and states why, and leaving the section commits a dirty draft rather than
discarding it.

#### Scenario: Enter commits the name

- **WHEN** the operator types a new name and presses `Enter`
- **THEN** the draft is committed, on a phone keyboard exactly as on a desktop keyboard

#### Scenario: A failed save keeps the draft

- **WHEN** the name PATCH is rejected
- **THEN** the field keeps showing what the operator typed and states that the save failed and why
