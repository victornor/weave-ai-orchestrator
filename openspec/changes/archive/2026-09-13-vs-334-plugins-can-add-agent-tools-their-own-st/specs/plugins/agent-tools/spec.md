## Purpose

Lets a plugin register a real MCP agent tool — one that appears in an agent's tool list, runs, and
returns the same `ToolResult` envelope as a core `weave_*` tool — without ever shadowing a core tool
name or leaking into a workspace that never loaded the plugin.

## ADDED Requirements

### Requirement: A registered plugin tool is callable by the agent kinds its scope names

A plugin tool registered with `scope: 'weaver' | 'worker' | 'all'` SHALL appear in the MCP tool list,
and be callable through it, for exactly the agent kinds that scope allows, in exactly the workspaces
that load the plugin (directly or via a daemon-wide plugin list).

#### Scenario: A worker-scoped plugin tool reaches a worker

- **WHEN** a plugin registers a tool with `scope: 'worker'` and is loaded for workspace `acme`
- **THEN** a worker agent's MCP tool list in `acme` includes that tool
- **AND** calling it returns `{ ok: true, data: ... }` on success

#### Scenario: A worker-scoped plugin tool does not reach the weaver

- **WHEN** the same tool is registered with `scope: 'worker'`
- **THEN** a weaver agent's MCP tool list in `acme` does not include it
- **AND** calling it by name as the weaver returns `{ ok: false, error: { code: 'forbidden', ... } }`

#### Scenario: A plugin tool from another workspace's plugin is absent

- **WHEN** a plugin is loaded only for workspace `acme`, not for workspace `beta`
- **THEN** an agent's MCP tool list in `beta` does not include that plugin's tool
- **AND** calling it by name in `beta` returns `{ ok: false, error: { code: 'not_found', ... } }`

### Requirement: A plugin tool name must be namespaced and cannot shadow a core tool

`registerAgentTool` SHALL reject, at load, a tool whose name does not match `^<pluginId>_[a-z0-9_]+$`
for that plugin's own id, or that collides with a core tool name (`COMMON_TOOLS`, `WEAVER_TOOLS`, or
`WORKER_ONLY_TOOLS`) or with a tool another plugin already registered in the same workspace. A
rejected tool is logged and skipped; it SHALL NOT stop the rest of that plugin's `register()` call or
any other plugin from loading.

#### Scenario: A plugin tool named like a core tool is rejected

- **WHEN** a plugin calls `registerAgentTool({ name: 'weave_ticket_get', ... })`
- **THEN** the tool is not added to that workspace's tool list
- **AND** the plugin's other registrations (tools, routes, hooks) still take effect

#### Scenario: A correctly namespaced tool is accepted

- **WHEN** a plugin with id `notes` calls `registerAgentTool({ name: 'notes_create', ... })`
- **THEN** `notes_create` is callable in every workspace that loads the `notes` plugin

#### Scenario: Two plugins collide on a tool name in one workspace

- **WHEN** plugin `a` and plugin `b` are both loaded for the same workspace and both attempt to
  register a tool named `shared_tool`
- **THEN** only the first plugin's `shared_tool` registration is accepted
- **AND** the second is logged and skipped without failing that plugin's load

### Requirement: A plugin tool runs through the same envelope and context as a core tool

A plugin tool's handler SHALL receive `{ workspaceId, agentId, agentKind, projectId, ticketId, runId }`
for the calling agent, and any exception it throws SHALL be caught and returned as
`{ ok: false, error }` without crashing the calling agent's run or turn.

#### Scenario: A throwing plugin tool fails only that call

- **WHEN** a plugin tool's handler throws
- **THEN** the tool call returns `{ ok: false, error: { code, message, retryable } }`
- **AND** the agent's run continues and can make further tool calls
