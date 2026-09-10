## Purpose

A conductor turn always spawns with permission bypass so the runtime cannot
classify away control-plane tools. Worker turns keep the role and workspace
permission mode.

## ADDED Requirements

### Requirement: Conductor turns spawn with permission bypass

When the system starts a turn for an agent whose kind is conductor, the
spawn permission mode SHALL be `bypass`. The workspace default permission
mode and any role permission mode SHALL NOT apply to that spawn.

#### Scenario: Workspace default auto does not apply to the conductor

- **WHEN** the workspace default permission mode is `auto` and a conductor turn starts
- **THEN** that turn's spawn permission mode is `bypass`

#### Scenario: A conductor role set to auto is still bypassed

- **WHEN** a conductor agent's role permission mode is `auto` and a conductor turn starts
- **THEN** that turn's spawn permission mode is `bypass`

### Requirement: Worker turns keep role and workspace permission mode

A worker turn's spawn permission mode SHALL continue to resolve from the
worker's role, then the workspace default, then `auto`. This change SHALL
NOT alter worker permission defaults.

#### Scenario: Worker with workspace default auto stays auto

- **WHEN** the workspace default permission mode is `auto`, the worker role does not set a permission mode, and a worker turn starts
- **THEN** that turn's spawn permission mode is `auto`

#### Scenario: Worker role bypass is unchanged

- **WHEN** a worker role permission mode is `bypass` and a worker turn starts
- **THEN** that turn's spawn permission mode is `bypass`

#### Scenario: Worker role restricted is unchanged

- **WHEN** a worker role permission mode is `restricted` and a worker turn starts
- **THEN** that turn's spawn permission mode is `restricted`

### Requirement: Claude maps bypass to skip-permissions flags

When a Claude turn's spawn permission mode is `bypass`, the Claude argv
SHALL include `--permission-mode bypassPermissions` and
`--allow-dangerously-skip-permissions`.

#### Scenario: Claude conductor argv skips the auto classifier

- **WHEN** a conductor turn starts on the Claude runtime
- **THEN** the Claude argv includes `--permission-mode bypassPermissions --allow-dangerously-skip-permissions`
