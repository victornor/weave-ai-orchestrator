## MODIFIED Requirements

### Requirement: Worker turns keep role and workspace permission mode

A worker turn's spawn permission mode SHALL continue to resolve from the
worker's role, then the workspace default, then `auto`. This change SHALL
NOT alter worker permission defaults. A Codex worker in `auto` mode with a
daemon-provisioned MCP server SHALL be launched with Codex's sandboxed
automatic approval posture, so it can invoke the ticket-scoped MCP tools it
is entitled to without changing the worker to `bypass` mode. Codex `restricted`
and `bypass` mode mappings SHALL remain distinct from `auto`.

#### Scenario: Worker with workspace default auto stays auto

- **WHEN** the workspace default permission mode is `auto`, the worker role does not set a permission mode, and a worker turn starts
- **THEN** that turn's spawn permission mode is `auto`

#### Scenario: Codex auto worker invokes its control-plane MCP server

- **WHEN** an `auto` worker turn runs on Codex with its daemon-provisioned MCP server
- **THEN** the Codex invocation uses its sandboxed automatic approval posture
- **AND** the worker can invoke the ticket-scoped read and write tools it is entitled to
- **AND** the invocation does not use Codex's bypass permission posture

#### Scenario: Resumed Codex auto worker keeps MCP access

- **WHEN** an `auto` Codex worker resumes or forks a session with its daemon-provisioned MCP server
- **THEN** its invocation preserves the sandboxed automatic approval posture
- **AND** the MCP server remains discoverable and callable

#### Scenario: Worker role bypass is unchanged

- **WHEN** a worker role permission mode is `bypass` and a worker turn starts
- **THEN** that turn's spawn permission mode is `bypass`

#### Scenario: Worker role restricted is unchanged

- **WHEN** a worker role permission mode is `restricted` and a worker turn starts
- **THEN** that turn's spawn permission mode is `restricted`
