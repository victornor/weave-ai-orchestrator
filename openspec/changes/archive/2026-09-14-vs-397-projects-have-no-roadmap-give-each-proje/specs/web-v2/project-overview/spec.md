## MODIFIED Requirements

### Requirement: The overview resolves a project and shows its kept sections

The screen SHALL resolve the address against the workspace's project list, accepting either a project's
slug or its id, and SHALL render the project's own sections: its about/identity block, Roadmap, History,
Pull requests, Recent landings, Activity, Needs you, Work under way and Knowledge. Each section SHALL read
its own data. An address that resolves to no project in the workspace SHALL show an empty state naming
the address, with a way to the workspace's Work screen, rather than an error.

#### Scenario: A project by slug or id

- **WHEN** the address names an existing project's slug or its id
- **THEN** the overview renders that project's sections

#### Scenario: All sections render

- **WHEN** a project's overview renders
- **THEN** Roadmap, History, Pull requests, Recent landings, Activity, Needs you, Work under way and
  Knowledge are each present, and each shows its own data or its own empty state

#### Scenario: No such project

- **WHEN** the address resolves to no project in the workspace
- **THEN** the screen shows an empty state naming the address and offering the workspace's Work screen
