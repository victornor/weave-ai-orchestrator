## MODIFIED Requirements

### Requirement: A turn resolves its runtime and model from one setting

Before a turn is launched the system SHALL resolve the runtime, the model and the effort it will
use from exactly one source: the effective conductor setting for a turn of the conductor; for a
turn of a worker, the worker option named by that worker's ticket when that option still exists in
the effective catalog and has a runtime chosen, otherwise the effective workers setting; for a turn
of a persistent session, the worker option the session was opened with or last changed to, when that
option still exists in the effective catalog and has a runtime chosen, otherwise the effective
workers setting. The effective setting or catalog SHALL be the workspace's own stored value when it
has configured one, otherwise the daemon overlay when that overlay is filled, otherwise the schema's
built-in default. It SHALL NOT read a runtime, a model or an effort from the role, the project or
the agent row to make that choice, and there SHALL be no fallback chain behind that source other
than letting the runtime choose the model when the resolved setting names none, and falling back to
the effective workers setting when the ticket or the session names an option that is no longer in
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

#### Scenario: A ticketless session runs on the workers setting

- **WHEN** a persistent session's turn is launched and the session names no worker option
- **THEN** it is launched on the runtime, model and effort of the workers setting

#### Scenario: A session runs on its chosen option

- **WHEN** a persistent session's turn is launched and the session names a worker option that still
  exists in the catalog and has a runtime chosen
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

#### Scenario: Changing a session's option changes its next launch

- **WHEN** a persistent session's worker option is changed and the session takes its next turn
- **THEN** that turn is launched on the new option's runtime, model and effort

#### Scenario: A setting naming an unregistered runtime

- **WHEN** a turn resolves a runtime that is not registered on this daemon
- **THEN** the turn fails naming that runtime, and no other runtime is used in its place

#### Scenario: A workspace's own setting wins over a filled daemon overlay

- **WHEN** a workspace has configured its own conductor or workers setting and a daemon overlay is
  also filled for that same control
- **THEN** the turn resolves to the workspace's own setting, not the daemon overlay

### Requirement: Changing the runtime starts a new session

A session handle belongs to the runtime that issued it. When the runtime a turn resolves is not the
runtime of the agent's current session, the system SHALL NOT resume that session: it SHALL retire
it, start a new session on the resolved runtime, and tell the agent in that turn that its session
restarted.

Changing only the model or the effort SHALL NOT retire the session.

For a persistent session, the same rule applies when its worker option moves it to a different

runtime: the session is retired and a new one is started, and its surface states before the change
is applied that the conversation will restart. Moving a session back to a runtime it used before
that retirement is a new start on that runtime, never a resume of the retired thread.

#### Scenario: The runtime changes under a running agent

- **WHEN** a setting's runtime is changed and the agent it governs takes its next turn
- **THEN** its previous session is retired, a new session is started on the new runtime, and no
  handle from the old runtime is passed to the new one
- **AND** the turn is told that its session restarted

#### Scenario: Only the model changes

- **WHEN** a setting's model or effort is changed but its runtime is not
- **THEN** the agent's session is kept and resumed as usual

#### Scenario: A session option change across runtimes retires the session

- **WHEN** a persistent session's worker option is changed to one on a different runtime
- **THEN** the current session is retired and the next turn starts a new session on the new runtime

#### Scenario: Changing back does not resume the retired thread

- **WHEN** a persistent session that was retired by a runtime change is moved back to the runtime it
  used before
- **THEN** a new session is started on that runtime rather than the retired thread being resumed
