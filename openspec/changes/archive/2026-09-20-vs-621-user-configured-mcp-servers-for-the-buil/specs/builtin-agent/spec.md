## ADDED Requirements

### Requirement: MCP servers are declared in workspace config with secrets by reference

The workspace config SHALL carry an `mcpServers` map from a server name to a definition with `type` (`http` or `stdio`), `url` and `headers` for HTTP, `command`, `args` and `env` for stdio, `listTimeoutMs`, `callTimeoutMs` and `readOnly`. The schema SHALL require `command` for a stdio server and `url` for an HTTP server, SHALL refuse the reserved run-scoped name `weave-ai`, and SHALL refuse unknown keys. A value in a server's `env` or `headers` MAY contain a `${SECRET_NAME}` reference; a referenced name SHALL be a valid workspace secret name, and a literal secret value SHALL NOT be required or accepted as the only spelling of a secret. A server definition SHALL NOT contain a secret value.

#### Scenario: A stdio server without a command is refused
- **WHEN** a workspace config defines an `mcpServers` entry with `type: stdio` and no `command`
- **THEN** validation fails and names that field

#### Scenario: An HTTP server without a url is refused
- **WHEN** a workspace config defines an `mcpServers` entry with `type: http` and no `url`
- **THEN** validation fails and names that field

#### Scenario: The reserved Weave name is refused
- **WHEN** a workspace config defines an `mcpServers` entry named `weave-ai`
- **THEN** validation fails, because that name is the run-scoped server's and cannot be overridden

### Requirement: A run is given only the MCP servers its role allows

A role SHALL carry an `mcpServers: string[]` allow list, defaulting to none. A workspace-level weaver allow list SHALL name the servers the weaver may use. A `weave`-runtime run SHALL receive exactly the servers named by its role's list — or by the weaver list when the run is the weaver — that also exist in `mcpServers`, plus the run-scoped `weave-ai` entry. A named server with no matching definition SHALL be ignored with a log and SHALL NOT fail the run. A persistent session SHALL be covered by its role's list. An allow list SHALL NOT select a server for any runtime other than `weave`.

#### Scenario: A role with no servers gets none
- **WHEN** a role's `mcpServers` is empty and it runs a `weave` turn
- **THEN** the run's `mcpServers` contains only the run-scoped `weave-ai` entry

#### Scenario: A role's allowed server is present
- **WHEN** a role names a configured server in its `mcpServers` and a `weave` turn runs for it
- **THEN** the run's `mcpServers` contains that server and the run-scoped `weave-ai` entry, and no other user server

#### Scenario: An unknown name does not fail the run
- **WHEN** a role names a server that is not defined in the workspace config
- **THEN** the run starts without it and a log records the missing name

### Requirement: Server secrets are resolved at run time and never reach a transcript or file

The engine SHALL resolve every `${SECRET_NAME}` reference in an allowed server's `env` and `headers` from the workspace secret store, SHALL add each resolved value to the run's redaction set, and SHALL pass the server its own `env` on top of the minimal server base only — never the run token and never the provider key. A server whose referenced secret has no stored value SHALL be omitted from the run with a log, so it never starts unauthenticated. The run's `mcp.json` SHALL record the definitions with references and redactions, never a resolved secret value, and no resolved value SHALL appear in an event, a log line or a transcript.

#### Scenario: A referenced secret reaches the server and is redacted
- **WHEN** a server's `env` references a stored workspace secret and the server reports its own environment in a tool result
- **THEN** the server's environment carries the secret's value and the run's events and log lines carry it only as `[redacted]`

#### Scenario: The run token and provider key are absent from a server's environment
- **WHEN** a stdio server lists its own environment during a turn
- **THEN** neither the run token nor the provider key variable is present

#### Scenario: A missing secret omits the server
- **WHEN** a server references a secret that has no stored value
- **THEN** the server is not offered to the run, the run continues, and a log records the missing reference

#### Scenario: No secret is written to mcp.json
- **WHEN** a run with a secret-referencing server writes its `mcp.json`
- **THEN** the file contains the reference and no resolved value

### Requirement: A server's timeouts are configurable and reach the client

A server definition's `listTimeoutMs` SHALL bound `initialize` and `tools/list` and `callTimeoutMs` SHALL bound `tools/call`, defaulting to 30 s and 60 s when unset. The values SHALL travel from workspace config through the run's `mcpServers` to the child's MCP client without changing the child protocol version.

#### Scenario: A configured call timeout is applied
- **WHEN** a server is configured with a `callTimeoutMs` and a tool call exceeds it
- **THEN** the call fails with the timeout rather than the default

## MODIFIED Requirements

### Requirement: The three permission modes decide the tool set up front

`restricted` SHALL expose only `read`, `grep`, `glob`, the run-scoped Weave server's tools, and the tools of a user MCP server whose definition sets `readOnly: true` and that the role's allow list names; it SHALL remove the write-capable tools (`write`, `edit`, `bash`) and every other user MCP server's tools from the request body itself so the model is never offered them. `auto` SHALL expose all six core tools plus every allowed MCP server's tools, enforce the confinement rules and the bash deny patterns, and never ask for approval. `bypass` SHALL expose all tools, skip the bash deny patterns and skip root confinement for reads, while the protected-path list still applies to the file tools. A call the mode does not allow SHALL return `Denied by permission mode "<mode>"` and SHALL emit a `tool.denied` event rather than an unknown-tool error.

#### Scenario: Restricted request body
- **WHEN** a turn runs in `restricted` with the run-scoped Weave server and a user MCP server available
- **THEN** the recorded request body's tool list contains only `read`, `grep`, `glob` and the run-scoped Weave tools, and no user `mcp__…` tool

#### Scenario: A read-only user server survives restricted
- **WHEN** a turn runs in `restricted`, the role allows a server marked `readOnly: true`, and the server lists its tools
- **THEN** that server's `mcp__…` tools are in the request body's tool list

#### Scenario: Forced call in restricted
- **WHEN** the model calls `write` in a `restricted` turn
- **THEN** the result is `Denied by permission mode "restricted"` and a `tool.denied` event is emitted
