# web-settings/remove-project Specification

## Purpose
Lets the operator remove a project from a workspace in Settings, using the existing archive
endpoint, with copy that states what is kept and what is not, and a readable refusal when workers
are still on the project.

## Requirements

### Requirement: An active project can be removed from workspace settings

The workspace settings Projects section SHALL offer a Remove control on each project that is not
archived. Confirming SHALL call the existing `DELETE /projects/:id` for that project. After a
successful remove the project SHALL no longer be active in this workspace: it is archived, dropped
from the workspace declaration, and absent from the sidebar's project list.

The control SHALL NOT claim the project is deleted, that tickets or knowledge are destroyed, or
that the clone is removed from disk.

#### Scenario: Removing an active project with no live workers

- **WHEN** the operator confirms Remove on an active project that has no workers other than retired
  or done
- **THEN** the project is archived in this workspace, disappears from the sidebar's project list,
  and is no longer offered as an active project in Settings

#### Scenario: The confirm copy states archive semantics

- **WHEN** the operator opens Remove on an active project
- **THEN** the confirm copy says the project is archived (not deleted), that tickets and knowledge
  stay in this workspace, and that the clone is left on disk

### Requirement: Removal with live workers is refused as a reason

A project that still has any worker whose status is not `retired` or `done` SHALL NOT be removable.
The Remove control SHALL present that as a reason the action is unavailable, including the count
when it is known. A conflict returned by `DELETE /projects/:id` SHALL be shown the same way, not as
a generic failure.

#### Scenario: Live workers disable Remove

- **WHEN** an active project has one or more workers that are not retired or done
- **THEN** Remove is unavailable and the reason names that those workers are still on the project

#### Scenario: A conflict from DELETE is a reason, not a crash

- **WHEN** the operator confirms Remove and `DELETE /projects/:id` answers with a conflict that the
  project still has live workers
- **THEN** the project remains active and the operator is shown that reason, not a generic error

### Requirement: An archived project is not editable or removable from Settings

A project whose status is archived SHALL still be listed in the Projects section so the operator
can see it was archived rather than destroyed. It SHALL NOT offer Remove, Move, or the per-project
edit controls (max workers, landing branch, YOLO).

#### Scenario: An archived row is visible and inert

- **WHEN** the Projects section includes a project whose status is archived
- **THEN** the row is shown as archived and offers neither Remove nor Move nor the edit controls
  an active row has
