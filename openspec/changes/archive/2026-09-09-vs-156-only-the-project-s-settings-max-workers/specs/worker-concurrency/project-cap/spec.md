## Purpose

Defines the only concurrency limit that stops a new worker spawning: the project's Settings max-workers value, shared by every role in that project. A role or hire MUST NOT have a private cap that queues work while the project still has slots.

## ADDED Requirements

### Requirement: The project's max-workers value is the only spawn cap

Spawning a worker for a ticket SHALL succeed whenever the number of live workers already in that ticket's project is below the project's max-workers value, regardless of how many live workers that ticket's role already has and regardless of the role's stored max-workers number.

A live worker is one whose status is provisioning, active, running, paused, or error. Workers of every role in the project count toward the same pool.

WHEN the project is at its max-workers value, spawn SHALL refuse with the same error code it uses today for a full project (`role_full`), naming the project and its limit. Pausing a role SHALL still prevent spawn for that role; that is not a concurrency cap.

#### Scenario: A third worker of one role still spawns under the project cap

- **WHEN** a project has max-workers 3, two roles in that project each have a stored max-workers of 2, and two workers of the first role are already live
- **THEN** spawning a third worker of the first role succeeds

#### Scenario: Mix of roles fills the project, not a private role cap

- **WHEN** a project has max-workers 3, two roles in that project, one live worker of the first role and one live worker of the second role
- **THEN** a second worker of the first role still spawns, and a fourth worker of any role in that project is refused because the project is full

#### Scenario: Spawn is refused only when the project is full

- **WHEN** a project's live worker count is already equal to its max-workers value
- **THEN** spawning another worker for any role in that project is refused with `role_full`, and the refusal names the project and its limit

#### Scenario: A stored role max-workers below the live count does not refuse spawn

- **WHEN** a role already has as many live workers as its stored max-workers value, and its project still has a free slot
- **THEN** spawning another worker of that role succeeds

### Requirement: Hire and role max-workers controls do not create a tighter spawn limit

Hiring a role, changing a role's stored max-workers value (the conductor tool, the CLI command, or a Team editor if one remains), and the hire-approval card SHALL NOT create a concurrency limit tighter than the project's Settings max-workers value. The project's Settings field SHALL remain the control that sets how many workers of that project may be live.

The Team page SHALL NOT offer a per-role max-workers editor, and SHALL NOT present a role's stored max-workers number as the denominator of how many workers that role may run.

#### Scenario: Team no longer edits a per-role spawn cap

- **WHEN** the operator opens a role on the Team page
- **THEN** there is no max-workers editor on that role, and the role is not shown as `live/roleMax` workers

#### Scenario: Raising or lowering a role's stored max-workers does not change who spawns

- **WHEN** a role's stored max-workers is set to 1 while its project allows 3, and one worker of that role is already live
- **THEN** a second worker of that role still spawns

#### Scenario: Settings remains the control

- **WHEN** the operator looks for the control that limits how many workers a project may run at once
- **THEN** it is the project's max-workers field on the Settings page, and changing it is what raises or lowers the spawn cap from the next spawn attempt
