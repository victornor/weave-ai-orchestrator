## Purpose

Gives a human a visible, explicit way to turn a project's knowledge-repo opt-in on, consistent with how the project's other settings are shown and changed.

## ADDED Requirements

### Requirement: The opt-in is offered when adding a project

The project-creation form SHALL offer the knowledge-repo opt-in as a checkbox, off by default, with a one-line explanation that the project's knowledge will be committed into its own repository.

#### Scenario: Adding a project with the checkbox left off

- **WHEN** a human adds a project without checking the knowledge-repo checkbox
- **THEN** the created project has knowledge-repo disabled

#### Scenario: Adding a project with the checkbox checked

- **WHEN** a human adds a project with the knowledge-repo checkbox checked
- **THEN** the created project has knowledge-repo enabled

### Requirement: The opt-in is visible and changeable on an existing project

An existing project's settings SHALL show its current knowledge-repo opt-in and let a human change it, using the same interaction pattern as the project's other toggleable settings.

#### Scenario: Viewing an opted-out project's settings

- **WHEN** a human opens an opted-out project's settings
- **THEN** the knowledge-repo toggle shows disabled

#### Scenario: Turning the toggle on

- **WHEN** a human turns the toggle on for an existing project
- **THEN** the project's knowledge-repo opt-in becomes enabled

This requirement covers only presenting and changing the flag; migrating a project's existing knowledge into or out of the repository when the flag changes is a dedicated follow-up, not part of this capability.
