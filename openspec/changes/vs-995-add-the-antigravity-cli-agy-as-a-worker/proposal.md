## Why

Captain wants workers that run on Google's Antigravity CLI (`agy`) and its Gemini 4 models (Neon, Argon, Hydrogen, Orchestrator), chosen per ticket like any other worker option. `agy` 1.5.14's print mode is close to Claude Code's (`-p`, `stream-json` in and out, `--json-schema`, `--model`, `--effort`, `--conversation`), so most of the adapter is familiar.

Two things make it more than a copy of the Claude adapter:

- **MCP.** `agy` has no `--mcp-config`/`--strict-mcp-config`, and `--settings` rejects MCP servers. Verified against the real binary in a sandbox: `agy -p /config --settings '{"mcpServers":{…}}'` → `Error: --settings: unknown setting "mcpServers"`. MCP servers come only from `<gemini dir>/config/mcp_config.json`. Captain's own file there already lists a personal server (`blender`), so a worker using the default dir would load it. That is the opencode leak again.
- **Auth.** `agy` keeps its Google OAuth login in the OS keyring when a D-Bus session bus exists, which is the case for the daemon. That leaves no credential file to read an expiry from. A headless run without a usable login does not fail fast. It prints `Authentication required. Please visit the URL to log in:` on stderr and blocks for 60 s waiting for a pasted code. Unless the adapter catches that, an expired agy login stalls every agy worker for a minute and then fails as an unclassified error. It must instead reach the same login gate a Claude auth failure does (the shared Claude login expired on 14 September, 3 October and 22 November).

## What Changes

- New runtime package `@weave-ai/runtime-agy` (adapter id `agy`, display name "Antigravity CLI"), registered alongside the others in the daemon, `weave runtime`, `weave doctor` and the install checks.
- **Per-agent config dir.** Every turn runs `agy --gemini_dir <agent home>/.agy …`. `--gemini_dir` is a root flag that 1.5.14 accepts but does not list in `--help`. It moves the whole `.gemini` tree to the given path: `mcp_config.json`, plugins, hooks, global rules and skills, settings, and conversation history. Before each turn the adapter writes that dir's `config/mcp_config.json` with exactly the run's MCP servers. Captain's `~/.gemini` is never read. Because the flag is undocumented, `detect()` checks that it still works (`agy --gemini_dir <tmp> mcp list` must list only a seeded server; it needs no login and no network). If the check fails, the runtime reports itself unavailable instead of leaking.
- **Turns.** A turn is `agy -p --output-format stream-json --json-schema <report schema> --model <variant id> --dangerously-skip-permissions|--mode … [--conversation <id>] [--add-dir <worktree>]`. The prompt goes on argv (stdin above the argv limit). Its NDJSON stream is translated into the normalized run events, with usage, the `conversation_id` as the session ref, and `structured_output` as the report. Live mid-turn input (`--input-format stream-json`) is out of scope for v1 (`streamingInput: false`).
- **Effort.** A model is chosen as a family (`gemini-4-neon`, `gemini-4-argon`, `gemini-4-hydrogen`) plus an effort, and the adapter composes the exact variant id `agy models` lists (`gemini-4-neon-high`). It never passes `--effort`, so a model id and a conflicting effort flag can never both reach the CLI. Orchestrator ids take no effort.
- **Auth.** The adapter watches stderr for the login prompt. On the first such line it kills the turn and returns an `auth`-family error with a fixed message. The OAuth URL is never copied into stored text. The `authentication failed or timed out` result and the mid-session `Authentication expired` message are classified the same way. From there the existing login gate, card, channel announcement and incident apply unchanged. `weave runtime login agy` and the outage text name `agy` as the native login.
- **Isolated daemons.** The keyring is per OS user, not per config dir. An isolated daemon (VS-143) therefore runs agy with the D-Bus session variables removed. `agy` then falls back to file-based token storage inside the empty per-agent dir and fails to authenticate, instead of using the owner's real login.
- **Models.** `listModels()` returns the families under the names captain used ("Gemini 4 Neon", "Gemini 4 Argon", "Gemini 4 Hydrogen", "Orchestrator (Neon)", "Orchestrator (Argon)"), with each family's efforts. Gemini 3.8 Flash is included. Claude and GPT-OSS ids offered through agy are deliberately left out.
- A capture script for the owner, run once, records the real `stream-json` bytes of an authenticated turn, its MCP tool call and a resumed second turn. The event parser's fixtures are written from that capture, not from guesses.
- An ADR records the reliance on the hidden `--gemini_dir` flag and the alternatives that were rejected.

## Capabilities

### New Capabilities
- `agy-runtime`: the Antigravity CLI runtime adapter: invocation, per-agent config isolation and the MCP surface, model/effort mapping, session resume, structured report, authentication-failure classification, and the isolated-daemon credential boundary.

### Modified Capabilities
(none — the login gate, worker-option catalog and model resolution are reused unchanged)

## Impact

- New: `packages/runtimes/agy/` (adapter, args, events, session, account, tests, fixtures).
- Touched: `packages/server/src/daemon.ts` (`RUNTIME_PACKAGES`), `packages/server/package.json`, `packages/shared/src/runtime-login.ts` (`NATIVE_LOGIN`), `packages/cli/src/commands/runtime.ts`, `doctor.ts`, `install.ts`, `packages/core/src/runs/engine.ts` (D-Bus stripping on isolated daemons), tsconfig/vitest references, `docs/adr/0025-…`, `docs/OPERATIONS.md` (runtime table).
- No schema or API change. The worker-option catalog entries (`agy-neon`, `agy-argon`, `agy-hydrogen`, `agy-orchestrator`) are configuration: they are added on the live daemon after the upgrade, through the models settings, not by this diff.
- Built against `agy` 1.5.14 (`/home/v/.local/bin/agy`).
