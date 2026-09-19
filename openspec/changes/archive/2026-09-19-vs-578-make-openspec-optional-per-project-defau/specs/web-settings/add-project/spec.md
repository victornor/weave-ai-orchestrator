## ADDED Requirements

### Requirement: The add-project form offers the OpenSpec choice, defaulting on

The Settings add-project form SHALL offer a control for the new project's OpenSpec mode, defaulting
to on, and SHALL send it to `POST /projects` as the project-config `openspec` block. `POST /projects`
SHALL accept that block, persist the mode on the created project, and continue to reject any key it
does not recognize. A project added with the control left at its default on SHALL have its OpenSpec
mode on; a project added with it off SHALL have it off and SHALL NOT have OpenSpec adopted in its
repository.

#### Scenario: Adding with OpenSpec on

- **WHEN** the operator submits the add-project form with the OpenSpec control on
- **THEN** `POST /projects` accepts the request and the created project's OpenSpec mode is on

#### Scenario: Adding with OpenSpec off

- **WHEN** the operator submits the add-project form with the OpenSpec control off
- **THEN** `POST /projects` accepts the request, the created project's OpenSpec mode is off, and project setup does not adopt OpenSpec

#### Scenario: The default is on when the control is untouched

- **WHEN** the operator submits the add-project form without changing the OpenSpec control
- **THEN** the created project's OpenSpec mode is on
