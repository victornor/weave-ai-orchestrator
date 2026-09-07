## ADDED Requirements

### Requirement: A turn resolves its runtime and model from one setting

Before a turn is launched the system SHALL resolve the runtime, the model and the effort it will
use from exactly one of the two workspace settings: the conductor setting for a turn of the
conductor, the workers setting for a turn of a worker. It SHALL NOT read a runtime, a model or an
effort from the role, the project or the agent row to make that choice, and there SHALL be no
fallback chain behind the setting other than letting the runtime choose the model when the setting
names none.

A resolved runtime that is not registered on this daemon SHALL fail the turn with the error the
system already uses for an unreachable runtime, naming the runtime, rather than falling back to
another one.

#### Scenario: A worker runs on the workers setting

- **WHEN** a worker's turn is launched
- **THEN** it is launched on the runtime, model and effort of the workers setting

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

### Requirement: Changing the runtime starts a new session

A session handle belongs to the runtime that issued it. When the runtime a turn resolves is not the
runtime of the agent's current session, the system SHALL NOT resume that session: it SHALL retire
it, start a new session on the resolved runtime, and tell the agent in that turn that its session
restarted.

Changing only the model or the effort SHALL NOT retire the session.

#### Scenario: The runtime changes under a running agent

- **WHEN** a setting's runtime is changed and the agent it governs takes its next turn
- **THEN** its previous session is retired, a new session is started on the new runtime, and no
  handle from the old runtime is passed to the new one
- **AND** the turn is told that its session restarted

#### Scenario: Only the model changes

- **WHEN** a setting's model or effort is changed but its runtime is not
- **THEN** the agent's session is kept and resumed as usual

### Requirement: A run records what it actually ran on

A run SHALL record the runtime it was launched on and the model that was used, taking the model
from what the runtime reported when it reports one and from the resolved setting otherwise. That
record SHALL describe the run that happened and SHALL NOT be changed by a later change to a
setting, so that cost and usage stay attributed to what was really spent.

#### Scenario: The runtime reports its model

- **WHEN** a turn finishes and the runtime reported the model it used
- **THEN** the run records that model

#### Scenario: The runtime reports no model

- **WHEN** a turn finishes and the runtime reported no model
- **THEN** the run records the model resolved from the setting, or that the runtime chose when the
  setting named none

#### Scenario: A later setting change does not rewrite history

- **WHEN** a setting is changed after a run has finished
- **THEN** the finished run still records the runtime and model it ran on
