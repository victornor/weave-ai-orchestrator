# workspace-navigation/project-colour Specification

## Purpose
Defines the stable colour every project in a workspace is identified by, so that anywhere the web
app names a project — the sidebar, the chat's project selector, a dispatch label, a worker chip —
a human can tell at a glance what belongs to what, without that colour ever being confused for one
of the app's status colours.

## Requirements

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

### Requirement: The palette stays clear of the app's status and accent colours

The set of colours a project may be assigned SHALL be fixed and hand-picked, not generated from an
arbitrary hash-to-hue range, and SHALL be chosen so that none of them is readily confused, in
either the light or the dark theme, with any of the app's status colours (idle, working, stalled,
blocked, needs-you, merging, done, failed, paused) or with the app's accent colour. A project's
colour SHALL NOT be capable of being mistaken for one of those meanings by a human glancing at it.

#### Scenario: A project colour next to a status glyph

- **WHEN** a project's colour is applied to identifying text next to a status glyph (for example
  on a dispatch label)
- **THEN** the two are visually distinguishable from one another and neither is a status colour
  wearing a project's name

### Requirement: The palette's colours are mutually distinguishable

Every colour in the fixed palette SHALL be visually distinguishable from every other colour in it,
in both themes, so that a workspace with several projects shown together does not present two
projects that look like the same colour.

#### Scenario: Several projects shown together

- **WHEN** three or more projects with different ids are shown in the same view (for example the
  sidebar, or the chat's project selector)
- **THEN** each project's colour, if distinct from the others assigned, is visually distinguishable
  from theirs

### Requirement: A project with no colour assigned shows no marker

A surface that would show a project's colour SHALL leave the identifying text in its default
colour — not a neutral or placeholder colour, and not a circle — for anything that is not
associated with a project (a workspace-wide message, a ticket with no project, an agent with no
project).

#### Scenario: Work with no project

- **WHEN** a dispatch, worker chip, or message has no project associated with it
- **THEN** its identifying text is not tinted with a project colour, and no colour circle is shown
  for it

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
- **THEN** all four colour their identifying text with the same colour

### Requirement: Project colour is the identifying text, never a circle

A surface that shows a project's colour SHALL apply that colour to the identifying text for
that work — the project's display label where a project is named, the ticket identifier on a
dispatch label, the worker name on a worker chip. It SHALL NOT show a separate circle, disc,
dot, or swatch filled with the project colour. Status glyphs and sync-state markers that
already exist on those surfaces SHALL remain, and SHALL remain visually distinguishable from
the project-coloured text.

#### Scenario: Sidebar names the project in colour

- **WHEN** a sidebar group lists a project
- **THEN** that project's display label is shown in that project's colour, and no project-colour
  circle is shown on the row

#### Scenario: A composer project tag names the project in colour

- **WHEN** the chat's project selector renders a project's tag
- **THEN** the tag's label is shown in that project's colour, and the tag has no
  project-colour circle

#### Scenario: A dispatch label names the ticket in colour

- **WHEN** a dispatch label is shown for a ticket that belongs to a project
- **THEN** the ticket identifier is shown in that project's colour, and the label has no
  project-colour circle

#### Scenario: A worker chip names the worker in colour

- **WHEN** a worker chip is shown for an agent whose project is known
- **THEN** the worker name is shown in that project's colour, and the chip has no
  project-colour circle
