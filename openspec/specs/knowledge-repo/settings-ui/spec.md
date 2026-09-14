# knowledge-repo/settings-ui Specification

## Purpose
Gives a human a visible, explicit way to turn a project's knowledge-repo opt-in on, consistent with how the project's other settings are shown and changed.

## Requirements

### Requirement: The opt-in is offered when adding a project

The project-creation form SHALL offer the knowledge-repo opt-in as a checkbox, off by default, with a one-line explanation that the project's knowledge will be committed into its own repository.

#### Scenario: Adding a project with the checkbox left off

- **WHEN** a human adds a project without checking the knowledge-repo checkbox
- **THEN** the created project has knowledge-repo disabled

#### Scenario: Adding a project with the checkbox checked

- **WHEN** a human adds a project with the knowledge-repo checkbox checked
- **THEN** the created project has knowledge-repo enabled

### Requirement: The opt-in is visible and changeable on an existing project

An existing project's settings SHALL show its current knowledge-repo opt-in and let a human change it, using the same interaction pattern as the project's other toggleable settings. Changing it SHALL start the reviewed migration defined by `knowledge-repo/switch-migration`; while that migration is pending the row SHALL show that it is waiting for its pull request to merge, SHALL link to the pull request, and SHALL say that closing it cancels the change, and the toggle SHALL NOT be changeable again until the migration resolves.

#### Scenario: Viewing an opted-out project's settings

- **WHEN** a human opens an opted-out project's settings
- **THEN** the knowledge-repo toggle shows disabled

#### Scenario: Turning the toggle on

- **WHEN** a human turns the toggle on for an existing project
- **THEN** a migration begins and the row shows that it is waiting for the pull request to merge

#### Scenario: Viewing a project with a pending switch

- **WHEN** a human opens the settings of a project whose migration pull request is open
- **THEN** the row links to the pull request and says that closing it cancels the change
