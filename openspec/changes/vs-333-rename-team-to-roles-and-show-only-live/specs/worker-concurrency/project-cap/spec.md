## MODIFIED Requirements

### Requirement: Hire and role max-workers controls do not create a tighter spawn limit

Hiring a role, changing a role's stored max-workers value (the weaver tool, the CLI command, or a
Roles editor if one remains), and the hire-approval card SHALL NOT create a concurrency limit
tighter than the project's Settings max-workers value. The project's Settings field SHALL remain the
control that sets how many workers of that project may be live.

The Roles page SHALL NOT offer a per-role max-workers editor, and SHALL NOT present a role's stored
max-workers number as the denominator of how many workers that role may run.

#### Scenario: Team no longer edits a per-role spawn cap

- **WHEN** the operator opens a role on the Roles page
- **THEN** there is no max-workers editor on that role, and the role is not shown as `live/roleMax` workers

#### Scenario: Raising or lowering a role's stored max-workers does not change who spawns

- **WHEN** a role's stored max-workers is set to 1 while its project allows 3, and one worker of that role is already live
- **THEN** a second worker of that role still spawns

#### Scenario: Settings remains the control

- **WHEN** the operator looks for the control that limits how many workers a project may run at once
- **THEN** it is the project's max-workers field on the Settings page, and changing it is what raises or lowers the spawn cap from the next spawn attempt
