## MODIFIED Requirements

### Requirement: A turn resolves its runtime and model from one setting

Before a turn is launched the system SHALL resolve the runtime, the model and the effort it will
use from exactly one source: the effective conductor setting for a turn of the conductor; for a
turn of a worker, the worker option named by that worker's ticket when that option still exists in
the effective catalog and has a runtime chosen, otherwise the effective workers setting. The
effective setting or catalog SHALL be the daemon overlay when that overlay is filled, otherwise
the workspace's stored value. It SHALL NOT read a runtime, a model or an effort from the role, the
project or the agent row to make that choice, and there SHALL be no fallback chain behind that
source other than letting the runtime choose the model when the resolved setting names none, and
falling back to the effective workers setting when the ticket names an option that is no longer in
the effective catalog.

A named option that still exists but has no runtime SHALL NOT fall back to the workers setting
and SHALL NOT launch any runtime. That turn SHALL fail as specified in
`model-selection/unconfigured-option`.

A resolved runtime that is not registered on this daemon SHALL fail the turn with the error the
system already uses for an unreachable runtime, naming the runtime, rather than falling back to
another one.

#### Scenario: A worker runs on the workers setting

- **WHEN** a worker's turn is launched and its ticket names no worker option, or names an option
  that is no longer in the catalog
- **THEN** it is launched on the runtime, model and effort of the workers setting

#### Scenario: A worker runs on its ticket's named option

- **WHEN** a worker's turn is launched and its ticket names a worker option that still exists in
  the catalog and has a runtime chosen
- **THEN** it is launched on that option's runtime, model and effort, not the workers setting

#### Scenario: The conductor runs on the conductor setting

- **WHEN** the conductor's turn is launched
- **THEN** it is launched on the runtime, model and effort of the conductor setting

#### Scenario: Role, project and agent state cannot influence the choice

- **WHEN** a role, a project or an agent record names a runtime or a model different from the
  setting that governs the turn
- **THEN** the turn is still launched on the setting's runtime, model and effort

#### Scenario: Changing the setting changes the next launch

- **WHEN** a setting's runtime or model is changed and the agent it governs takes its next turn
- **THEN** that turn is launched on the new runtime and model

#### Scenario: A setting naming an unregistered runtime

- **WHEN** a turn resolves a runtime that is not registered on this daemon
- **THEN** the turn fails naming that runtime, and no other runtime is used in its place
