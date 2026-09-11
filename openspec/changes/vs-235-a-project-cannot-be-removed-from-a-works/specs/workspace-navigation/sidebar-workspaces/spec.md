## MODIFIED Requirements

### Requirement: A workspace group lists its projects, each opening that project's overview

Every expanded sidebar group — the active workspace's, which is always expanded, and any other
workspace's group the human has expanded — SHALL list that workspace's **active** (non-archived)
projects, below its section links, each identified by the project's slug. An archived project SHALL
NOT appear as a row in the group. Activating a project SHALL open that project's overview page;
when the project belongs to a workspace other than the one currently being shown, activating it
SHALL also make that project's workspace the active one, as part of the same navigation, so the
rail and the content never disagree about which workspace is showing. Following a project SHALL
navigate within the running application, without a document reload.

A workspace's projects SHALL be fetched the first time its group is expanded, and kept from then on:
collapsing and re-expanding the same group SHALL NOT fetch again. A workspace whose group has never
been expanded SHALL NOT have its projects fetched. The active workspace's projects SHALL be fetched
regardless of whether its group has been explicitly expanded, since that group is always open.

While a group's projects are being fetched for the first time, that group SHALL show a loading state
distinguishable from having no projects — a group SHALL NOT render as though a workspace has no
projects while its fetch is still outstanding. A workspace that genuinely has no projects SHALL show
its section links and no project rows, without an empty-list error; the New project action SHALL
still be shown. When a workspace's project fetch fails, that group alone SHALL show that it could
not load its projects; every other group, expanded or collapsed, SHALL be unaffected and SHALL keep
working.

#### Scenario: Opening a project

- **WHEN** the human activates a project in the active workspace's sidebar group
- **THEN** that project's overview opens, without a document reload

#### Scenario: Opening a project in a non-active workspace

- **WHEN** the human expands a non-active workspace's group, its projects have loaded, and the human
  activates one of them
- **THEN** that project's overview opens, that workspace becomes the active one, and the rail and the
  content agree on which workspace is showing

#### Scenario: Another workspace's group

- **WHEN** a non-active workspace's group is expanded and its projects have loaded
- **THEN** it shows that workspace's section links and that workspace's own projects, each identified
  by its slug

#### Scenario: Expanding a non-active workspace lists its projects

- **WHEN** the human expands a workspace group that has never been expanded before, and that
  workspace has projects
- **THEN** its projects are fetched and then listed, each identified by its slug

#### Scenario: A workspace with no projects

- **WHEN** a workspace's group is expanded (or, for the active workspace, shown) and that fetch
  completes with no projects
- **THEN** its group shows its section links and no project rows, the New project action is shown,
  and no error is shown

#### Scenario: Loading is not mistaken for empty

- **WHEN** a workspace's group is expanded and its project fetch has not yet completed
- **THEN** the group shows a loading state, not an empty project list and not the workspace's
  projects from before the fetch started

#### Scenario: A failed fetch is scoped to its own group

- **WHEN** one workspace's project fetch fails while another workspace's group is also expanded
- **THEN** the failed workspace's group shows that its projects could not load, and the other
  expanded group still lists its own projects normally

#### Scenario: Collapsing and re-expanding does not refetch

- **WHEN** the human collapses a non-active workspace's group whose projects already loaded, then
  expands it again
- **THEN** its projects are shown immediately from what was already fetched, with no new request

#### Scenario: A workspace never expanded costs nothing

- **WHEN** the sidebar renders with several workspaces listed and only some of their groups ever
  expanded
- **THEN** projects are never fetched for a workspace whose group has not been expanded and is not
  the active workspace

#### Scenario: An archived project is not listed

- **WHEN** a workspace's fetched projects include one whose status is archived
- **THEN** that project is not shown as a row in the group, and the New project action remains
