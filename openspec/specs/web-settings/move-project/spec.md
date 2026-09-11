# web-settings/move-project Specification

## Purpose
Lets the operator move a project from this workspace to another workspace on the same daemon by
archiving it here and adding it there, after being told what travels and what stays behind.

## Requirements

### Requirement: An active project can be moved to another workspace

The workspace settings Projects section SHALL offer a Move control on each project that is not
archived, when this daemon has at least one other workspace. Confirming SHALL add the project to
the chosen destination with the source project's git URL and project settings (slug, name, default
branch, landing branch, max workers, setup command, policies), then archive it in the source
workspace (the same remove as `web-settings/remove-project`). The destination add is the existing
`POST /projects` (accepted before the clone job finishes). The source SHALL NOT be archived until
that add has been accepted.

Tickets, knowledge, spec index, runs and usage SHALL remain in the source workspace under the
archived project. The destination SHALL clone the repository afresh and SHALL NOT reuse the source
clone on disk. The source clone SHALL be left on disk.

Tickets, knowledge, spec index, runs and usage SHALL remain in the source workspace under the
archived project. The destination SHALL clone the repository afresh and SHALL NOT reuse the source
clone on disk. The source clone SHALL be left on disk.

#### Scenario: Moving to another workspace

- **WHEN** the operator confirms Move of an active project to another workspace on this daemon, and
  that destination does not already have a project with the same slug
- **THEN** the destination begins cloning that project with the same git URL and project settings,
  and the project is archived in the source workspace

#### Scenario: Move is not offered with only one workspace

- **WHEN** this daemon has no workspace other than the current one
- **THEN** Move is not offered as an available action

### Requirement: Before confirming a move the operator is told what travels and what stays

The move confirmation SHALL name the destination workspace and SHALL state, before any request is
sent: the repository and the copied project settings go to the destination; tickets, knowledge,
spec index, runs and usage stay in this workspace under the archived project; the clone on disk
here is left; the destination clones afresh.

#### Scenario: Confirm copy names what travels

- **WHEN** the operator opens Move and picks a destination
- **THEN** the confirm copy names that destination and states that history stays in this workspace,
  that the source clone is left on disk, and that the destination clones afresh

### Requirement: A move is refused as a reason when workers are live or the destination already has the slug

A project that still has any worker whose status is not `retired` or `done` SHALL NOT be movable,
with the same reason presentation as Remove. If the destination already has a project with the same
slug, Move SHALL be refused as a reason **before either workspace is written**.

A failure of the destination add SHALL leave the source project active and SHALL tell the operator
they can retry the move. A failure of the source archive after the destination add has been
accepted SHALL leave the project in both workspaces and SHALL tell the operator the destination
already has it and to Remove it here.

#### Scenario: Live workers disable Move

- **WHEN** an active project has one or more workers that are not retired or done
- **THEN** Move is unavailable and the reason names that those workers are still on the project

#### Scenario: Destination slug clash is refused before archive

- **WHEN** the operator confirms Move to a workspace that already has a project with the same slug
- **THEN** the source project remains active, neither workspace is written, and the operator is
  shown that the destination already has that project, not a generic error

#### Scenario: Destination add failure leaves the source active

- **WHEN** adding the project to the destination fails
- **THEN** the source project remains active and the operator is told they can retry the move

#### Scenario: Source archive failure after destination add is explained

- **WHEN** the destination add is accepted and archiving the source then fails
- **THEN** the operator is told the destination already has the project and to Remove it from this
  workspace
