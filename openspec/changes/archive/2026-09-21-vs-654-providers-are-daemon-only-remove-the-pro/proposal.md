## Why

Providers for the built-in `weave` runtime were built (VS-610, VS-633) at two scopes: defined once in `daemon.yaml` and overridable per workspace, with a workspace Settings → Providers page. Captain has decided providers are daemon-only. The workspace page duplicates the daemon page and lets one workspace silently shadow the daemon's provider profiles and keys, while MCP servers are meant to keep their per-workspace overrides. This change removes the workspace-level provider surface and leaves MCP servers exactly as they are.

## What Changes

- **BREAKING (UI)**: Remove the Providers section and its navigation entry from the workspace settings scope. The old URL `/settings?scope=<ws>&section=providers` renders the workspace settings home (the scope's first section) — a clean fallback, not a 404. The daemon scope's Providers section is unchanged.
- **BREAKING (API)**: Remove the workspace-scoped provider administration surface — `GET/PUT/DELETE /api/w/:ws/providers`, `POST|DELETE /api/w/:ws/providers/:id/disable`, `POST|DELETE /api/w/:ws/providers/:id/secret`, `POST /api/w/:ws/providers/:id/test` and `POST /api/w/:ws/providers/:id/discover`. The daemon routes `/api/daemon/providers…` are unchanged.
- Daemon runs resolve both the provider profile and its key from the daemon's `providers` and the daemon secret store only. A workspace contributes no profile, no override, no `disabledProviders` entry and no key.
- **BREAKING (`weave repl`)**: The terminal REPL no longer reads a workspace's `providers` or `disabledProviders`; it reads `daemon.yaml` and the user's `agent.yaml` (plus flags). Its workspace `mcpServers` / `disabledMcpServers` layer is unchanged.
- Legacy data is preserved, not migrated. `providers` and `disabledProviders` stay in `WorkspaceConfigSchema` so a stored block never strips on load or save, but they are ignored. A non-empty legacy block logs one notice per workspace per process.
- Docs and specs are updated to say providers are daemon-only. MCP server docs and specs are unchanged.
- Out of scope: MCP servers at both scopes; the daemon Providers page; the provider schema, presets and probe logic.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-config-scopes`: providers become daemon-only (no workspace define/override/disable, no workspace-first provider key, no workspace provider routes or Settings section); the REPL provider precedence loses its workspace layer; MCP requirements are unchanged. A new requirement records that a legacy workspace provider block loads, is ignored and is never deleted.
- `web-v2/settings`: the workspace scope's four Providers requirements are removed; the daemon scope owns the Providers section and the workspace scope is specified to offer none.
- `builtin-agent`: the provider read / profile-write / key / redaction / lookup / models-discovery requirements are retargeted to the daemon scope and store; the workspace-scoped provider lookup requirement is replaced.
- `agent-repl`: the REPL's provider configuration sources lose the workspace layer; a workspace `providers` block is ignored.

## Impact

- **Server**: `packages/server/src/routes/providers.ts`, `src/app.ts`, `src/routetable.ts`, `src/daemon.ts` (runtime host), `src/routes/workspace.ts` (config response keeps the retained legacy fields).
- **Core**: `packages/core/src/scoped.ts`, `src/runs/engine.ts`, `src/workspace/loader.ts` (ignore plus one notice).
- **Shared**: `packages/shared/src/config.ts` (the two fields retained and marked deprecated).
- **UI**: `packages/ui/src/v2/settings/sections.ts`, `V2Settings.tsx`, `sections/Providers.tsx`; `api/hooks.ts`, `api/keys.ts`, `api/types.ts`.
- **Agent**: `packages/agent/src/repl/config.ts`.
- **Docs**: `docs/API.md`, `docs/running-the-agent-yourself.md`.
- **Tests**: server provider-route and runtime-provider-scope tests, UI provider/scope/settings tests, core engine and loader tests, agent REPL config tests, shared scoped-config/config tests.
