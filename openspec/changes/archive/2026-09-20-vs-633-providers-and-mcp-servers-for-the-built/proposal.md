## Why

Captain (2026-09-20): model providers and MCP servers for the built-in `weave` agent are configured per workspace, but they should be configured once, in the daemon settings, so a worker option that uses the built-in agent works in every workspace with nothing configured per workspace. A workspace may still override.

## What Changes

- `providers` and `mcpServers` become fields of the daemon config (`daemon.yaml`) with the existing schemas.
- A workspace entry with the same id/name **replaces** the daemon entry for that workspace (whole entry, no deep merge); a workspace may add entries; a workspace may switch off an inherited one with `disabledProviders` / `disabledMcpServers`.
- A daemon-level encrypted secret store (`daemon-secrets.enc/.key` in the daemon config dir, same AES-256-GCM shape as `push-vapid.enc`). Name resolution: workspace store, then daemon store. Values are never returned, and are redacted from transcripts.
- Settings: Providers and MCP servers move to the daemon scope; the workspace scope shows inherited entries (read-only, "from daemon") and overrides, with Override / Remove override.
- API: daemon routes `/api/daemon/providers` and `/api/daemon/mcp-servers` (with secret and test); workspace routes return the merged view marked by `source`.
- The runtime host and the run engine build providers and MCP servers from the merged set. A role or weaver allow-list naming a server that exists at neither level now **fails the run** with a clear message (today it only logs).
- `weave repl` also reads `daemon.yaml` (and the daemon secret store) from the config dir: user `agent.yaml` > workspace > daemon.
- Docs: running-the-agent-yourself, `builtin-agent-design` (open question 3 reversed), `docs/API.md`.

Not changed: existing workspace `providers`/`mcpServers` keep working as workspace-level entries; no migration.

## Capabilities

### New Capabilities
- `agent-config-scopes`: daemon-level providers, MCP servers and secrets for the built-in agent, and the workspace override rules.

### Modified Capabilities
None. (The `builtin-agent` requirements about a workspace-held key still hold; this adds a second scope.)

## Impact

`packages/shared/src/config.ts`, `packages/core` (loader, engine, secrets), `packages/server` (daemon.ts runtime host, routes, routetable, docs), `packages/runtimes/weave`, `packages/agent/src/repl/config.ts`, `packages/ui` Settings, docs.
