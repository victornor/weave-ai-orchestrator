## MODIFIED Requirements

### Requirement: Every project has a stable, deterministic colour

Each project SHALL have a colour derived deterministically from the project's id together with
the set of project ids in its workspace, drawn from a small, fixed set of hand-picked colours.
Given the same project id and the same set of workspace project ids, the same project SHALL
receive the same colour on every render, after every reload, and on every device — nothing about
it SHALL be chosen at random at render time, and nothing about it SHALL be stored per project.
Adding a project SHALL NOT change the colour of any project already in that workspace.

#### Scenario: The same project reloaded

- **WHEN** the same project's colour is read twice, including after a reload of the app, against
  the same set of workspace project ids
- **THEN** both reads return the same colour

#### Scenario: No storage involved

- **WHEN** a project's colour is computed
- **THEN** nothing is written to the project's record or to any per-device store to produce it

## ADDED Requirements

### Requirement: Colours are unique within a workspace while a free slot exists

Among the projects of one workspace, no two SHALL share a colour while the palette still has an
unused colour. A newly added project SHALL therefore receive a colour that no other project in
that workspace already has whenever such a colour exists. When every palette colour is already
used by at least one project in that workspace, a newly added project SHALL receive a least-used
colour from that same fixed palette. The palette SHALL NOT grow.

Surfaces that show a project's colour — the sidebar, the chat's project tags, a dispatch label, a
worker chip — SHALL all use this assignment, so they stay consistent with one another.

#### Scenario: Adding while a colour is free

- **WHEN** a project is added to a workspace that still has at least one unused palette colour
- **THEN** the new project's colour is one that no existing project in that workspace has

#### Scenario: Adding when every colour is taken

- **WHEN** a project is added to a workspace where every palette colour is already used by at
  least one project
- **THEN** the new project is assigned a least-used colour from the existing palette, and the
  palette is not expanded

#### Scenario: Sidebar, tags and chips agree

- **WHEN** the same project's colour is shown on the sidebar, a chat project tag, a dispatch
  label and a worker chip
- **THEN** all four show the same colour
