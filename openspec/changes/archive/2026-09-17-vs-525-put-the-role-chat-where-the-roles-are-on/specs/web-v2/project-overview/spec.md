## MODIFIED Requirements

### Requirement: The overview resolves a project and shows its kept sections

The screen SHALL resolve the address against the workspace's project list, accepting either a project's slug or its id, and SHALL render the project's own sections: its about/identity block, Roadmap, Roles, History, Pull requests, Recent landings, Activity, Needs you, Work under way and Knowledge. Each section SHALL read its own data. An address that resolves to no project in the workspace SHALL show an empty state naming the address, with a way to the workspace's Work screen, rather than an error.

#### Scenario: A project by slug or id

- **WHEN** the address names an existing project's slug or its id
- **THEN** the overview renders that project's sections

#### Scenario: All sections render

- **WHEN** a project's overview renders
- **THEN** Roadmap, Roles, History, Pull requests, Recent landings, Activity, Needs you, Work under way and Knowledge are each present, and each shows its own data or its own empty state

#### Scenario: No such project

- **WHEN** the address resolves to no project in the workspace
- **THEN** the screen shows an empty state naming the address and offering the workspace's Work screen

## ADDED Requirements

### Requirement: The overview lists the project's roles under its roadmap

The overview SHALL list the project's hired roles in a section immediately following Roadmap. Each listed role SHALL show its name, its state, and whether its persistent session already exists or would be created when opened, so an existing conversation is distinguishable before activation from one that would start. Choosing a role's session control SHALL open that role's persistent session through the same operation the roles screen uses. A role that cannot serve a session (its status is not `active`) SHALL NOT offer the control and SHALL state the reason. A project with no hired roles SHALL say so rather than showing an empty list.

#### Scenario: Every role of the project is listed under the roadmap

- **WHEN** a project's overview renders and the project has hired roles
- **THEN** each role is listed in a section immediately after Roadmap, with its name and state

#### Scenario: An existing session and a new one look different

- **WHEN** one listed role already has a persistent session and another does not
- **THEN** the first offers to open its conversation and the second offers to start one

#### Scenario: Opening from the overview

- **WHEN** the human chooses a role's session control on the overview
- **THEN** that role's persistent session opens and its conversation is shown

#### Scenario: A role that cannot serve a session

- **WHEN** a listed role is paused or retired
- **THEN** its row offers no session control and states the reason

#### Scenario: A project with no roles

- **WHEN** a project's overview renders and the project has no hired roles
- **THEN** the Roles section says so rather than showing an empty list
