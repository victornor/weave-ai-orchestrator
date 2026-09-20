# agent-config-scopes Specification

## Purpose
Where the built-in agent's model providers, MCP servers and their secrets are configured: once at the daemon level, visible to every workspace, with an optional per-workspace override.

## Requirements

### Requirement: Providers and MCP servers may be defined at the daemon level
`daemon.yaml` SHALL accept `providers` and `mcpServers` with the same schemas as `workspace.yaml`. Every workspace SHALL see them. A workspace with neither field SHALL resolve exactly the daemon's set.

#### Scenario: Daemon-only provider
- **WHEN** a provider exists only in `daemon.yaml`
- **THEN** a run in any workspace resolves that provider and can name it in a worker option (runtime `weave`, model `<provider>/<model>`)

### Requirement: A workspace entry replaces the daemon entry whole
For a provider id or MCP server name defined at both levels, the workspace entry SHALL replace the daemon entry for that workspace, with no field-level merge. A workspace MAY add entries the daemon lacks, and MAY disable an inherited entry with `disabledProviders` / `disabledMcpServers`. Removing the override SHALL restore the daemon's entry. Existing workspace-level entries SHALL keep working unchanged.

#### Scenario: Override and restore
- **WHEN** a workspace defines provider `x` and the daemon also defines `x`
- **THEN** that workspace resolves its own `x` and other workspaces resolve the daemon's; deleting the workspace entry restores the daemon's

#### Scenario: Disable
- **WHEN** a workspace lists `x` in `disabledProviders` and defines no `x`
- **THEN** `x` does not resolve in that workspace

### Requirement: Daemon secrets resolve after workspace secrets
The daemon SHALL keep an encrypted secret store in its config directory. A secret name (a provider `apiKeySecret` or an MCP `${NAME}` reference) SHALL resolve from the workspace store first, then the daemon store. A value SHALL never appear in a route response, a log line, `mcp.json`, or a transcript; daemon secret values SHALL be redacted from transcripts as workspace ones are. Routes report only whether a secret is held.

#### Scenario: Daemon key found
- **WHEN** a run's workspace holds no secret of the provider's `apiKeySecret` name and the daemon store does
- **THEN** the run uses the daemon's value

#### Scenario: Workspace wins
- **WHEN** both stores hold the name
- **THEN** the workspace value is used

### Requirement: A missing allowed MCP server fails the run
When a role's (or the weaver's) allow-list names an MCP server defined at neither level, a `weave` run SHALL fail before starting with a message naming the server and the role.

#### Scenario: Removed server
- **WHEN** a role allows `docs` and neither `daemon.yaml` nor the workspace defines it
- **THEN** the run fails with an error naming `docs`

### Requirement: Administration at both scopes
The daemon SHALL expose provider and MCP-server administration (list, put, delete, secret, test) under `/api/daemon/`. Workspace routes SHALL keep their shapes and add `source` (`daemon`, `workspace`, `override`) and a disabled marker to each entry. Settings SHALL show Providers and MCP servers in the daemon scope; the workspace scope SHALL show inherited entries read-only and offer Override and Remove override.

#### Scenario: Marked merged view
- **WHEN** a workspace lists providers
- **THEN** a daemon-only entry has `source: "daemon"`, a workspace-only entry `"workspace"`, and a replaced one `"override"`

### Requirement: The terminal agent reads the daemon config
`weave repl` SHALL read `daemon.yaml` from the config directory when present (the daemon need not run). Precedence, highest first: the user's `agent.yaml`, the nearest workspace, the daemon. A literal `apiKey` SHALL be honoured only in the user's `agent.yaml`.

#### Scenario: Daemon provider, nothing else
- **WHEN** only `daemon.yaml` defines a provider and no workspace or `agent.yaml` exists
- **THEN** `weave repl` uses it
