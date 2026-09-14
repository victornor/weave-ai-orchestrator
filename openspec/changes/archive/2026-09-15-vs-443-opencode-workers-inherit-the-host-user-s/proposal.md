# Stop opencode workers inheriting the owner's MCP servers

Tracker change for [VS-443](weave://tickets/VS-443). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

The daemon gives every opencode turn a per-workspace runtime config home
(`<workspace>/.agent-conductor/runtimes/opencode`) and links two files from the owner's own config
into it (`credentialPaths`, `packages/core/src/workspace/loader.ts`):

- `~/.config/opencode/opencode.json` → `<home>/opencode/opencode.json`
- `~/.config/opencode/opencode.jsonc` → `<home>/opencode/opencode.jsonc`

That link was added so custom `provider` definitions (cheaper-inference, codeify) reach a turn, but
it shares the whole file. The owner's config also carries a personal remote MCP server belonging to
another workspace (`mcp.vautoig`), and potentially `plugin` entries. Every worker therefore loads
that server's tool definitions into its first request — measured at roughly 46,350 input tokens
before any work (VS-435 `01M2GX51E7EXPPQQM6R8X6BCME`, VS-437 `01M2GX85BNKQZ6QQ2JX1F409B3`) — and
can call another workspace's tools, breaking the project boundary.

`runtime-credentials/single-credential` already says "Only the credential is shared" and "Settings
stay per workspace"; the config symlink is the exception this change removes.

## What changes

- `packages/core/src/workspace/loader.ts`: `credentialPaths('opencode')` no longer lists the two
  config files — only `auth.json`, which stays a symlink. A new
  `generateOpencodeWorkerConfig(hostConfigDir, workspaceConfigHome)` reads the owner's
  `opencode.json` / `opencode.jsonc` (JSONC-comment-tolerant, best-effort), keeps only `$schema`,
  `autoupdate` and `provider`, and writes a fresh per-workspace `opencode.json`. It always removes
  any `opencode.json`/`opencode.jsonc` already in the workspace home first, so an upgraded workspace
  drops the old host symlink and nothing writes through it to the owner's file.
- `linkRuntimeCredentials` calls that generator for `opencode`, so both call sites regenerate: at
  workspace load and on every turn (`reconcileRuntimeCredential` in `packages/core/src/runs/engine.ts`).
  A provider edited in the owner's config reaches the next turn.
- Isolated daemons (VS-143) read from their own `credentials/opencode` dir, never the host; with no
  config there they generate nothing, exactly as before.
- `packages/core/src/workspace/credentials.test.ts`: the opencode block asserts the generated config
  carries providers but no `mcp`/`plugin`, that a host `mcp` server never reaches it, that a provider
  change is reflected on the next link, that JSONC is read, that auth.json stays linked, and that an
  isolated daemon generates nothing and leaves the host file alone.

## Other runtimes

Checked `claude`, `codex`, `gemini` and `cursor`: none is affected. Each isolates through a dedicated
config-dir variable (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `CURSOR_CONFIG_DIR`) and
passes its MCP servers explicitly (Claude `--mcp-config`/`--strict-mcp-config`, Codex `-c` overrides,
Gemini `.gemini/settings.json`, Cursor `.cursor/mcp.json`). Only the credential file is linked into
their runtime home, so no host MCP config is symlinked in. Listed in the delivery.

## Out of scope

The owner's personal opencode setup (their plugins, skills and MCP servers) and the exact token
breakdown (a separate scout ticket).