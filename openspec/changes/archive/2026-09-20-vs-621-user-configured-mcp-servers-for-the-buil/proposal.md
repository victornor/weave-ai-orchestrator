## Why

Slice 8 (VS-613, merged) gave the built-in `weave` agent a stdio MCP transport, collision-safe `mcp__<server>__<tool>` naming and a shared result cap, but the engine still supplies only the run-scoped `weave-ai` HTTP server: a human cannot point the built-in agent at any other MCP server. Captain asked for parity with what Claude, OpenCode and Codex support (2026-09-20), and user-configured MCP servers are the missing part. This change sources MCP servers from workspace and role config, wires the allowed ones into the run, and gives them a Settings surface — without ever storing a secret in config.

## What Changes

- **Workspace config** gains an `mcpServers` map: named definitions of `type` (`http`/`stdio`), `url`/`headers` or `command`/`args`/`env`, and `listTimeoutMs`/`callTimeoutMs`, with a Zod schema and cross-field validation (stdio requires `command`, HTTP requires `url`, the reserved `weave-ai` name is refused).
- **Secrets by reference**: a value in `env` or `headers` may contain `${SECRET_NAME}`; the name is resolved from the workspace secret store at run time and the resolved value is redacted from every event, log and transcript. A referenced secret with no stored value omits that server from the run (fail closed) rather than starting it unauthenticated. No secret is stored in `workspace.yaml`, returned by any route, or written to the run's `mcp.json`.
- **Selection** is an allow list, default none: a new `mcpServers: string[]` on a role, plus a workspace-level `weaver.mcpServers` list for the weaver (which has no role). Persistent sessions run under their role and are covered by the role list. A run gets only the named servers plus the always-present `weave-ai` entry.
- **Engine wiring**: the allowed servers are resolved (secret references substituted) into the `weave` run's `mcpServers`; their `env` is the minimal server base plus the server's own configured values, so the run token and the provider key never reach a server. `mcp.json` records the definitions with references and redactions, never a resolved value.
- **Relation to other runtimes**: the workspace `mcpServers` definitions feed the built-in `weave` runtime only. Claude, OpenCode, Codex, Gemini and Cursor keep reading their own MCP config (`--mcp-config`, `.opencode`, `config.toml`, `.gemini/settings.json`, `.cursor/mcp.json`) exactly as today; role allow lists apply only to the built-in agent.
- **Settings UI**: a new workspace **MCP servers** section beside Providers to add, edit, remove and **Test** a server (Test lists its tools with a short timeout), with secret entry through the existing masked secret input; and a control on a role to allow servers.
- **Safety**: the section says a stdio server is arbitrary code the human chose to run on the host; user servers run with the minimal environment; their tools are subject to the run's permission mode, and `restricted` drops user MCP tools unless the server is marked `readOnly` in its config **and** the role allows it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `builtin-agent`: adds workspace MCP server definitions and secret-by-reference resolution, per-role and weaver selection, engine wiring of the allowed servers into the `weave` run, per-server timeouts, and the narrowed `restricted` rule for user MCP tools.
- `web-v2/settings`: a workspace MCP servers section (list, add/edit/remove, Test, masked secret input) and a role allow-servers control.

## Impact

- `packages/shared/src/config.ts` — `McpServerSchema`, `WorkspaceConfigSchema.mcpServers`, `WorkspaceConfigSchema.weaver.mcpServers`, `RoleSpecSchema.mcpServers`.
- `packages/runtime-sdk/src/index.ts` — `McpServerConfig` gains optional `listTimeoutMs`/`callTimeoutMs`.
- `packages/core/src/runs/engine.ts` — resolve allowed servers, substitute secret references, extend the redaction set, redact `mcp.json`.
- `packages/runtimes/weave/src/{child.ts,adapter.ts}` and `packages/agent/src/{protocol.ts,mcp/{client,http,stdio}.ts,loop.ts}` — thread the timeouts through and filter user MCP tools in `restricted`.
- `packages/server/src/routes/mcp.ts` (new) + `routetable.ts`, `docs/API.md`.
- `packages/ui/src/v2/settings/sections/McpServers.tsx` (new), `settings/sections.ts`, `settings/V2Settings.tsx`, `RolesPage.tsx`, `packages/ui/src/api/*`, `packages/ui/src/test/*`.
- Knowledge documents `builtin-agent-design`, `builtin-agent-runtime-details` and `builtin-agent-slices` updated where this change supersedes them.
- No database migration, no new dependency.
