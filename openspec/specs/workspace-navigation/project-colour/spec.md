# workspace-navigation/project-colour Specification

## Purpose
Defines the stable colour every project in a workspace is identified by, so that anywhere the web
app names a project — the sidebar, the chat's project selector, a dispatch label, a worker chip —
a human can tell at a glance what belongs to what, without that colour ever being confused for one
of the app's status colours.

## Requirements

### Requirement: Every project has a stable, deterministic colour

Each project SHALL have a colour derived purely and deterministically from the project's id, drawn
from a small, fixed set of hand-picked colours. The same project SHALL receive the same colour on
every render, after every reload, and on every device — nothing about it SHALL be chosen at random
at render time, and nothing about it SHALL be stored per project.

#### Scenario: The same project reloaded

- **WHEN** the same project's colour is read twice, including after a reload of the app
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

- **WHEN** a project's colour marker is shown next to a status glyph (for example on a dispatch
  label)
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

A surface that would show a project's colour SHALL show nothing — not a neutral or placeholder
colour — for anything that is not associated with a project (a workspace-wide message, a ticket
with no project, an agent with no project).

#### Scenario: Work with no project

- **WHEN** a dispatch, worker chip, or message has no project associated with it
- **THEN** no colour marker is shown for it
