## MODIFIED Requirements

### Requirement: Worker turns keep role and workspace permission mode

A worker turn's spawn permission mode SHALL continue to resolve from the
worker's role, then the workspace default, then `auto`. This change SHALL
NOT alter worker permission defaults. A Codex worker in `auto` or `restricted`
mode with a daemon-provisioned MCP server SHALL configure that server with
`default_tools_approval_mode="approve"` — the CLI's automatic-approval variant
for that key — so it can invoke the ticket-scoped MCP tools it is entitled to
without changing the worker to `bypass` mode. The adapter SHALL NOT write
`never` to that key, because `never` is a variant of the separate
`approval_policy` key and the CLI rejects the configuration outright when it
appears here. Codex `auto`, `restricted`, and `bypass` mode mappings SHALL
remain distinct: `auto` uses `workspace-write`, `restricted` uses `read-only`,
and `bypass` uses Codex's dangerous bypass posture.

#### Scenario: Worker with workspace default auto stays auto

- **WHEN** the workspace default permission mode is `auto`, the worker role does not set a permission mode, and a worker turn starts
- **THEN** that turn's spawn permission mode is `auto`

#### Scenario: Codex auto worker invokes its control-plane MCP server

- **WHEN** an `auto` worker turn runs on Codex with its daemon-provisioned MCP server
- **THEN** the Codex invocation uses `workspace-write` and configures its daemon-provisioned MCP server with `default_tools_approval_mode="approve"`
- **AND** the worker can invoke the ticket-scoped read and write tools it is entitled to
- **AND** the invocation does not use Codex's bypass permission posture

#### Scenario: Codex restricted worker invokes its control-plane MCP server

- **WHEN** a `restricted` worker turn runs on Codex with its daemon-provisioned MCP server
- **THEN** the Codex invocation uses `read-only` and configures its daemon-provisioned MCP server with `default_tools_approval_mode="approve"`
- **AND** the worker can invoke the ticket-scoped tools it is entitled to
- **AND** the invocation does not use Codex's bypass permission posture

#### Scenario: Resumed Codex auto worker keeps MCP access

- **WHEN** an `auto` or `restricted` Codex worker resumes or forks a session with its daemon-provisioned MCP server
- **THEN** its invocation preserves the mode's sandbox and the MCP server's `default_tools_approval_mode="approve"` setting
- **AND** the MCP server remains discoverable and callable

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
- **AND** its Codex sandbox remains `read-only`
