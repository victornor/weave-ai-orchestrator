## MODIFIED Requirements
### Requirement: Worker turns keep role and workspace permission mode
A worker turn's spawn permission mode SHALL continue to resolve from the worker's role, then the workspace default, then `auto`. This change SHALL NOT alter worker permission defaults. A Codex worker in `auto` or `restricted` mode with a daemon-provisioned MCP server SHALL configure that server with `default_tools_approval_mode="approve"`, so it can invoke the ticket-scoped MCP tools it is entitled to without changing the worker to `bypass` mode. The adapter SHALL NOT write `never` to that key. Codex `auto` SHALL use `approval_policy=on-request`, `restricted` SHALL decline escalations, and `bypass` SHALL use Codex's dangerous bypass posture; all three run with sandbox `danger-full-access`.

#### Scenario: Worker with workspace default auto stays auto
- **WHEN** the workspace default permission mode is `auto`, the worker role does not set a permission mode, and a worker turn starts
- **THEN** that turn's spawn permission mode is `auto`

#### Scenario: Codex auto worker invokes its control-plane MCP server
- **WHEN** an `auto` worker turn runs on Codex with its daemon-provisioned MCP server
- **THEN** the Codex invocation uses `danger-full-access`, `approval_policy=on-request` and `default_tools_approval_mode="approve"`
- **AND** the invocation does not use Codex's bypass permission posture

#### Scenario: Codex restricted worker invokes its control-plane MCP server
- **WHEN** a `restricted` worker turn runs on Codex with its daemon-provisioned MCP server
- **THEN** the Codex invocation uses `danger-full-access` and `default_tools_approval_mode="approve"`
- **AND** the invocation does not use Codex's bypass permission posture

#### Scenario: Resumed Codex auto worker keeps MCP access
- **WHEN** an `auto` or `restricted` Codex worker resumes or forks a session with its daemon-provisioned MCP server
- **THEN** its invocation carries `sandbox_mode="danger-full-access"` and the MCP server's `default_tools_approval_mode="approve"` setting

#### Scenario: The adapter never writes an approval value the CLI rejects
- **WHEN** a Codex turn writes the daemon-provisioned MCP server's `default_tools_approval_mode`
- **THEN** the value is `approve`
- **AND** the value `never` does not appear for that key

#### Scenario: Worker role bypass is unchanged
- **WHEN** a worker role permission mode is `bypass` and a worker turn starts
- **THEN** that turn's spawn permission mode is `bypass`

#### Scenario: Worker role restricted is unchanged
- **WHEN** a worker role permission mode is `restricted` and a worker turn starts
- **THEN** that turn's spawn permission mode is `restricted`
