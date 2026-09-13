## MODIFIED Requirements

### Requirement: The display label reaches every surface that names a project to a person

The web app SHALL show a project's display label — never its raw slug in place of the label — on
every surface a person reads a project's name from. That includes, at least: the sidebar's project
rows and the phone More menu's project list; the board's project filter and its ticket cards; the
ticket page's project meta and facts; the worker page's project meta; the Roles page's per-project
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

- **WHEN** the worker page, Roles, Merge queue, Knowledge, Usage, the Map or a decision label names a
  project that has a display name
- **THEN** each shows the display label rather than the slug

#### Scenario: A rename reaches an open view

- **WHEN** a project is renamed while another view that names it is open
- **THEN** that view shows the new label without the page being reloaded
