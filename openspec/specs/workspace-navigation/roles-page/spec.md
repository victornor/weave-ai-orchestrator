# workspace-navigation/roles-page Specification

## Purpose
The workspace section that groups the roles hired for each project with the worker instances
currently live under them — so a person reads the shape of the workspace's staff, and only the
work actually in progress, at a glance.

## Requirements

### Requirement: The workspace section is named Roles

The web app SHALL provide an addressable Roles page per workspace, at a path of that workspace,
named `Roles` wherever a person reads it: the desktop rail, the phone's tabs and More menu, the
page title, and every in-app link that opens it. The page SHALL replace the page previously named
`Team`; a request for the old address `/w/<workspace>/team` SHALL redirect to
`/w/<workspace>/roles` for the same workspace, so an existing link or bookmark keeps working.

Internal identifiers, route-parameter names and stored values are not display text and SHALL NOT be
required to change.

#### Scenario: The rail names the section Roles

- **WHEN** the desktop rail renders the workspace's section list
- **THEN** it contains a section labelled `Roles` and none labelled `Team`

#### Scenario: Opening the section

- **WHEN** the human activates Roles in the rail or on a phone
- **THEN** the app shows that workspace's Roles page without a document reload

#### Scenario: An old Team link still resolves

- **WHEN** a link to `/w/<workspace>/team` is followed
- **THEN** the app redirects to `/w/<workspace>/roles` for the same workspace and shows the Roles
  page

#### Scenario: Every in-app link says Roles

- **WHEN** the worker page's back link or the global Map's role action opens this page
- **THEN** the link reads `Roles` and addresses `/w/<workspace>/roles`

### Requirement: The Roles page lists only live worker instances under each role

Under each hired role the page SHALL list only the workers that are live: those whose status is
`provisioning`, `active`, `running`, `paused` or `error`. A worker that is `retired` SHALL NOT be
listed. A `done` worker whose work has landed (so it will retire through the normal sweep) SHALL
NOT be listed.

#### Scenario: Every live status is listed

- **WHEN** a role has one worker in each of `provisioning`, `active`, `running`, `paused` and
  `error`
- **THEN** all five are listed under that role

#### Scenario: A clean finished worker is not listed

- **WHEN** a role's only worker is `done` and its work has landed
- **THEN** the page lists no worker for that role, and no "finished" group

#### Scenario: A retired worker is not listed

- **WHEN** a role has a `retired` worker
- **THEN** that worker is not listed under the role

### Requirement: A kept finished worker is shown with the reason it is kept

When a `done` worker's worktree is still present because its work has not landed — so it needs a
human discard decision — the page SHALL show it in a "Finished, work kept" group under its role,
with the reason the daemon recorded for keeping it. The group SHALL show the number of such
workers. When a role has no kept finished worker, no such group SHALL appear. The worker SHALL
remain discardable through the existing purge action.

#### Scenario: A kept finished worker is visible

- **WHEN** a role has a `done` worker whose branch's commits are not contained in its landing
  branch, and the daemon recorded why
- **THEN** the page shows that worker in a "Finished, work kept" group under its role, with that
  reason

#### Scenario: The group counts its members

- **WHEN** a role has two kept finished workers
- **THEN** the group reads `Finished, work kept (2)`

#### Scenario: The group is absent when nothing is kept

- **WHEN** every finished worker of a role has landed and none is kept
- **THEN** no "Finished, work kept" group appears under that role

### Requirement: The header counts live workers

The Roles page header SHALL report the number of hired roles and the number of live workers — the
same live set the page lists — and SHALL NOT count every non-retired worker row.

#### Scenario: The count reflects live work only

- **WHEN** the workspace has two live workers and twenty `done` workers that have landed
- **THEN** the header reports `2 workers`, not `22`

#### Scenario: The count includes a kept finished worker as kept, not live

- **WHEN** the workspace has one live worker and one kept finished worker
- **THEN** the header reports `1 worker`, and the kept one appears only in the finished group
