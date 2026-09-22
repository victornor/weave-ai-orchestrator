## Purpose

A ticket that is assigned to a role belongs to that role's project, so a ticket's own project is
never null while a role says otherwise — every reader that resolves a ticket's project (opening its
pull request, linking a roadmap item, project-filtered listing) finds the project the work is
actually in.

## ADDED Requirements

### Requirement: A ticket created with an assignee role adopts that role's project

When a ticket is created with an `assigneeRoleId` and no `projectId`, the system SHALL set the
ticket's project to the project the role belongs to, so the created ticket's `projectId` is never
null while the role is project-scoped. When the caller also passes an explicit `projectId`, the
existing rule holds: a project that disagrees with the role's project SHALL be refused, and the
role's project is stored when they agree.

#### Scenario: A role with no project given derives the project

- **WHEN** a ticket is created with a project-scoped `assigneeRoleId` and `projectId` omitted or null
- **THEN** the created ticket's `projectId` is the role's project, not null

#### Scenario: A matching explicit project is kept

- **WHEN** a ticket is created with an `assigneeRoleId` and an explicit `projectId` equal to the
  role's project
- **THEN** the created ticket's `projectId` is that project

#### Scenario: A conflicting explicit project is refused

- **WHEN** a ticket is created with an `assigneeRoleId` and an explicit `projectId` that is not the
  role's project
- **THEN** creation is refused with a validation error, and no ticket is stored

#### Scenario: A ticket with no role keeps the current behaviour

- **WHEN** a ticket is created with no `assigneeRoleId` and no `projectId`
- **THEN** the ticket is stored with a null project, exactly as before this change

### Requirement: Assigning a role to a project-less ticket adopts the role's project

When a role is assigned to a ticket whose project is null, the system SHALL set the ticket's project
to the role's project, so an existing project-less ticket can be corrected by assigning it to the
role it is meant for. A ticket that already has a project SHALL keep the existing rule: assigning a
role from a different project is refused.

#### Scenario: Assigning a role fills in a missing project

- **WHEN** a ticket with `projectId` null is assigned to a project-scoped role
- **THEN** the ticket's `projectId` becomes the role's project

#### Scenario: Assigning across projects is still refused

- **WHEN** a ticket whose project is set is assigned to a role belonging to a different project
- **THEN** the assignment is refused with a validation error, and the ticket's project is unchanged

### Requirement: An upgrade backfills project-less tickets that name a role

When a workspace's database is migrated to this change, every ticket that has a null `projectId` and
an `assigneeRoleId` whose role has a project SHALL be given that role's project. The backfill SHALL
touch only such rows and SHALL be safe to apply to a database that has none.

#### Scenario: A ticket left project-less before the fix is corrected

- **WHEN** a database holds a ticket with a null `projectId` assigned to a project-scoped role, and
  the migration that carries this change runs
- **THEN** that ticket's `projectId` is the role's project

#### Scenario: Rows without a role are untouched

- **WHEN** the migration runs over a database
- **THEN** tickets that have no `assigneeRoleId`, and tickets that already have a project, are
  unchanged
