# project-naming Specification

## Purpose
One rule for what a project is called to a person: a project's display label is its name when it
has one and its slug otherwise, reaching every surface that names a project while the slug stays
wherever it identifies one.

## Requirements

### Requirement: A project's display label is its name, falling back to its slug

Every project SHALL have a stable slug and an optional display name. Wherever a project is named to
a person, the app SHALL show the project's display label: its name with surrounding whitespace
trimmed when that is non-empty, and otherwise its slug. A name that is absent, empty, or only
whitespace SHALL read as no name and fall back to the slug. The label SHALL be produced by one
shared rule, so no surface can disagree with another about what a project is called.

#### Scenario: A project that has a name

- **WHEN** a project has `name` set to a non-empty value, such as `Weave AI`
- **THEN** every surface that names it shows `Weave AI`

#### Scenario: A project with no name

- **WHEN** a project's `name` is empty or absent
- **THEN** every surface that names it shows its slug

#### Scenario: A name that is only whitespace

- **WHEN** a project's `name` is empty once trimmed, such as `'   '`
- **THEN** every surface that names it shows its slug, not the blank name

### Requirement: The display label reaches every surface that names a project to a person

The web app SHALL show a project's display label — never its raw slug in place of the label — on
every surface a person reads a project's name from. That includes, at least: the sidebar's project
rows and the phone More menu's project list; the board's project filter and its ticket cards; the
ticket page's project meta and facts; the worker page's project meta; the Team page's per-project
headings and worker cards; the Merge queue's project header and selector; the Knowledge area's
project filter, section headings and graph labels; the Usage page's per-project bars and legend; the
Map's project nodes and detail panel; the Settings project rows; the chat's project tags and project
picker; and any decision or dispatch label that names a project.

A name change SHALL be reflected on every one of these surfaces without a page reload.

#### Scenario: The sidebar and the phone menu

- **WHEN** a project named `Weave AI` is listed in the sidebar and in the phone More menu
- **THEN** both name it `Weave AI`

#### Scenario: The board and a ticket page

- **WHEN** the board's project filter and a ticket page name a project named `Weave AI`
- **THEN** both show `Weave AI`

#### Scenario: The remaining surfaces

- **WHEN** the worker page, Team, Merge queue, Knowledge, Usage, the Map or a decision label names a
  project that has a display name
- **THEN** each shows the display label rather than the slug

#### Scenario: A rename reaches an open view

- **WHEN** a project is renamed while another view that names it is open
- **THEN** that view shows the new label without the page being reloaded

### Requirement: The slug is kept wherever it identifies a project

The app SHALL keep showing a project's slug, not its display label, wherever the slug is an
identifier a person types, copies or a link relies on: the project's address and route parameters,
the knowledge paths and `[[links]]` built from it, CLI arguments, and the project's identity in
moving or removing it (including the destination slug-clash check). Where a surface shows the label
it MAY also show the slug as secondary text, but the label SHALL be the primary name and the slug
SHALL NOT replace it.

#### Scenario: Opening a project by its address

- **WHEN** a project with a display name is opened at its slug (or id) address
- **THEN** that project's overview opens, exactly as it did before it had a name

#### Scenario: A knowledge path still uses the slug

- **WHEN** a project's knowledge file or a `[[link]]` to one is produced
- **THEN** it is addressed by the project's slug, not its display label

#### Scenario: Move and remove still match on the slug

- **WHEN** a project is moved or removed
- **THEN** its identity and any slug clash are decided by its slug, unchanged by its display name

### Requirement: The daemon names projects to people and to the weaver by their label

Every string the daemon writes that names a project to a person or to the weaver SHALL use the
display label, falling back to the slug. This includes at least the weaver's rendered project list
in the workspace instructions (which SHALL name the project so that an unset name does not render a
blank label), decision titles, changelog entries, and ticket titles that name a project.

#### Scenario: The weaver's project list

- **WHEN** the workspace instructions render the weaver's project list and a project has a display
  name
- **THEN** the list names that project by its display label

#### Scenario: An unset name does not render a blank

- **WHEN** the weaver's project list renders a project whose name is empty
- **THEN** the project is named by its slug, with no empty or dangling label

#### Scenario: A daemon-written title uses the label

- **WHEN** the daemon writes a decision title or a ticket title that names a project with a display
  name
- **THEN** the title uses the display label, not the slug

#### Scenario: A changelog entry uses the label

- **WHEN** the changelog records activity attributed to a project with a display name
- **THEN** the entry names the display label

### Requirement: A rename reaches every open view without a reload

Changing a project's name SHALL emit the existing `project.updated` workspace event, and the web
app SHALL invalidate the query that holds the workspace's projects on that event, so every open
view that reads a project label is brought up to date without a page reload.

#### Scenario: A rename while another view is open

- **WHEN** the operator renames a project in Settings while the sidebar or the board is open on the
  same workspace
- **THEN** the sidebar and the board show the new label without a reload

#### Scenario: The event is what refreshes it

- **WHEN** the app receives a `project.updated` event for a project
- **THEN** it invalidates the workspace's project query, so the label is re-read
