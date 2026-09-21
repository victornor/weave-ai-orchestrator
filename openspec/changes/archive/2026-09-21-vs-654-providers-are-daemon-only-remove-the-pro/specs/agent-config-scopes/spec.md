## Purpose

Where the built-in agent's model providers, MCP servers and their secrets are configured. Model providers are daemon-only: `daemon.yaml` defines them once, every workspace resolves exactly the daemon's set, and a workspace cannot add, override, disable or key one. MCP servers keep the daemon level plus an optional per-workspace override.

## RENAMED Requirements

- FROM: `### Requirement: A provider's models are editable at both scopes`
- TO: `### Requirement: A provider's models are editable at the daemon scope`
- FROM: `### Requirement: Model discovery is available at both scopes`
- TO: `### Requirement: Model discovery is available at the daemon scope`

## MODIFIED Requirements

### Requirement: Providers and MCP servers may be defined at the daemon level

`daemon.yaml` SHALL accept `providers` and `mcpServers` with the same schemas as `workspace.yaml`. Every workspace SHALL see the daemon's providers. A workspace SHALL NOT define, override or disable a provider. `workspace.yaml` SHALL still accept `mcpServers` and `disabledMcpServers` with the optional per-workspace override below. A workspace with neither MCP field SHALL resolve exactly the daemon's MCP set.

#### Scenario: Daemon-only provider

- **WHEN** a provider exists only in `daemon.yaml`
- **THEN** a run in any workspace resolves that provider and can name it in a worker option (runtime `weave`, model `<provider>/<model>`)

#### Scenario: A workspace provider block is ignored

- **WHEN** a `workspace.yaml` still holds a non-empty `providers` map
- **THEN** the workspace's runs resolve the daemon's providers and the block changes nothing

### Requirement: A workspace entry replaces the daemon entry whole

For an MCP server name defined at both levels, the workspace entry SHALL replace the daemon entry for that workspace, with no field-level merge. A workspace MAY add MCP servers the daemon lacks, and MAY disable an inherited one with `disabledMcpServers`. Removing the override SHALL restore the daemon's entry. A workspace SHALL NOT override, add or disable a provider.

#### Scenario: Override and restore

- **WHEN** a workspace defines MCP server `x` and the daemon also defines `x`
- **THEN** that workspace resolves its own `x` and other workspaces resolve the daemon's; deleting the workspace entry restores the daemon's

#### Scenario: Disable

- **WHEN** a workspace lists MCP server `x` in `disabledMcpServers` and defines no `x`
- **THEN** `x` does not resolve in that workspace

### Requirement: Daemon secrets resolve after workspace secrets

The daemon SHALL keep an encrypted secret store in its config directory. A provider profile's `apiKeySecret` SHALL resolve from the daemon store only; a workspace secret store SHALL NOT contribute, override or shadow a provider key. An MCP `${NAME}` reference SHALL resolve from the workspace store first, then the daemon store. A value SHALL never appear in a route response, a log line, `mcp.json`, or a transcript; daemon secret values SHALL be redacted from transcripts as workspace ones are. Routes report only whether a secret is held.

#### Scenario: Daemon key found

- **WHEN** the daemon store holds the provider's `apiKeySecret`
- **THEN** the run resolves and uses the daemon's value

#### Scenario: Workspace wins

- **WHEN** an MCP `${NAME}` reference is set in both stores
- **THEN** the workspace value is used for the MCP server

### Requirement: Administration at both scopes

The daemon SHALL expose provider and MCP-server administration (list, put, delete, secret, test) under `/api/daemon/`. Provider administration SHALL exist at the daemon level only: there SHALL be no workspace-scoped provider route, no `source`/`disabled` marking and no workspace disable route. MCP-server administration SHALL exist at both scopes, the workspace routes adding `source` (`daemon`, `workspace`, `override`) and a disabled marker to each entry. Settings SHALL show Providers and MCP servers in the daemon scope; the workspace scope SHALL show MCP servers, with inherited entries read-only and Override and Remove override offered, and SHALL NOT show Providers.

#### Scenario: No workspace provider route

- **WHEN** a client requests `/api/w/:ws/providers`
- **THEN** the route does not exist

#### Scenario: Marked merged view

- **WHEN** a workspace lists MCP servers
- **THEN** a daemon-only entry has `source: "daemon"`, a workspace-only entry `"workspace"`, and a replaced one `"override"`

### Requirement: The terminal agent reads the daemon config

`weave repl` SHALL read `daemon.yaml` from the config directory when present (the daemon need not run). Provider precedence, lowest first: the daemon's `providers`, then the user's `agent.yaml`, then the command line. The nearest workspace SHALL contribute MCP servers only, never providers. A literal `apiKey` SHALL be honoured only in the user's `agent.yaml`.

#### Scenario: Daemon provider, nothing else

- **WHEN** only `daemon.yaml` defines a provider and no workspace or `agent.yaml` exists
- **THEN** `weave repl` uses it

#### Scenario: A workspace provider block is ignored

- **WHEN** the nearest workspace defines a provider and the user's `agent.yaml` and `daemon.yaml` do not
- **THEN** `weave repl` does not use that provider

### Requirement: A provider's models are editable at the daemon scope

Provider administration SHALL let an operator list, add, edit and remove the entries of a provider profile's `models` at the daemon scope. Each entry SHALL have a required id, unique within the profile, and the fields the provider model schema declares, rendered from that schema rather than as independent per-field controls. Saving SHALL write the entries into `profile.models` through the daemon put route, with no other field of the profile rebuilt from a subset.

#### Scenario: Editing models on a daemon provider

- **WHEN** an operator adds a model id and its context window on a daemon-scope provider and saves
- **THEN** the daemon provider's `profile.models` carries that entry and a later run can select `<provider>/<id>`

#### Scenario: Editing models on a workspace override

- **WHEN** an operator edits a provider's models and saves
- **THEN** the daemon profile carries those models and no workspace config is written

#### Scenario: Removing a model

- **WHEN** an operator removes a model entry and saves
- **THEN** the saved profile no longer lists it

#### Scenario: An empty models list is valid

- **WHEN** a provider with no models is opened
- **THEN** the editor shows an empty state and saving it keeps the provider with no models

### Requirement: Model discovery is available at the daemon scope

The models editor SHALL offer a fetch-from-endpoint action that requests the provider's model list through the daemon discovery route and shows the returned ids to pick from. Adding a picked id SHALL append it to the models list being edited. A failed discovery SHALL show its one-line reason and leave manual entry available. The action SHALL work against the profile being edited before it is saved, and with a key typed but not yet saved.

#### Scenario: Picking a discovered model

- **WHEN** discovery returns ids and the operator picks one
- **THEN** that id is added to the models list and is written on the next save

#### Scenario: Discovery fails

- **WHEN** the endpoint has no models list
- **THEN** the editor shows the one-line reason and the manual add control still works

#### Scenario: Before saving

- **WHEN** the operator has changed the base URL in the editor but not saved and triggers discovery
- **THEN** discovery uses the edited base URL

## ADDED Requirements

### Requirement: Legacy workspace provider entries are ignored, not deleted

A `workspace.yaml` that still holds `providers` or `disabledProviders` SHALL load without error. The workspace loader SHALL retain those fields untouched on every save, so no stored entry is deleted by this change, and SHALL NOT resolve them for any run or for the terminal agent. When a workspace config holds a non-empty provider block, the loader SHALL log one notice per workspace for the process, naming the workspace and saying that workspace providers are ignored and providers are configured in the daemon settings. No migration SHALL run.

#### Scenario: A legacy block still loads

- **WHEN** a workspace's config holds a non-empty `providers` map
- **THEN** the workspace loads and a run resolves the daemon's providers

#### Scenario: The block survives a config write

- **WHEN** any workspace config write occurs while the legacy block is present
- **THEN** `providers` and `disabledProviders` are still on disk afterwards

#### Scenario: One notice

- **WHEN** the same legacy workspace is loaded several times in one process
- **THEN** the ignore notice is logged once
