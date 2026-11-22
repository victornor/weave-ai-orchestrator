# ADR 0025 — The agy runtime isolates its config with `--gemini_dir`

**Status:** accepted · 2026-11-22 · VS-995 · built against agy 1.5.14

## Context

Captain asked for workers on Google's Antigravity CLI (`agy`), with every model its subscription
offers selectable: Gemini 4, Claude and GPT-OSS. A worker needs the weave MCP server and none of
the machine owner's own servers. The opencode runtime once loaded captain's personal MCP server
into every worker, and that must not happen again.

`agy` 1.5.14 has no `--mcp-config`/`--strict-mcp-config`. It reads MCP servers only from
`<gemini dir>/config/mcp_config.json`, plus plugins. `--settings`, documented as "settings for
this session only", rejects them: `agy -p /config --settings '{"mcpServers":{…}}'` →
`Error: --settings: unknown setting "mcpServers"`. The owner's own `~/.gemini/config/mcp_config.json`
already lists a personal server (`blender`).

All of this was established without the owner's login. The real binary ran inside `bwrap` with no
network, no D-Bus and no view of `/home`, and the rest came from its embedded changelog. Workers
never run a coding CLI against live credentials.

## Decision

Every `agy` invocation is `agy --gemini_dir <agent home>/.agy …`. `--gemini_dir` is a root flag
that 1.5.14 accepts but `--help` does not list. It moves the whole `.gemini` tree to the given
path:

- MCP config, plugins and hooks;
- global `GEMINI.md`/`AGENTS.md` rules and skills;
- `antigravity-cli/settings.json` and the conversations.

The adapter rewrites `config/mcp_config.json` with exactly the run's servers before each turn.
The path is always absolute, and the flag must come before any subcommand.

Because the flag is undocumented, the adapter checks it before trusting it. It seeds a scratch dir
with one server and runs `agy --gemini_dir <scratch> mcp list`, which needs no login and no
network. Exactly that server must be listed. `detect()` reports `unsupported` otherwise, and
`runTurn` runs the same check once per binary (path and mtime) and fails with a `tooling` error
before any prompt is sent.

The login is not affected. With a D-Bus session bus, as the daemon has, agy keeps its Google
sign-in in the OS keyring, independent of `--gemini_dir`. On an isolated daemon (VS-143) the
engine hides the bus (`DBUS_SESSION_BUS_ADDRESS` empty, `XDG_RUNTIME_DIR` an empty private dir) for
runtimes that declare `hostKeyring`. agy then falls back to file-based token storage and cannot use
the owner's login.

## Why not

| Alternative | Why not |
|---|---|
| `--settings` | Rejects `mcpServers` (verified). |
| Per-worker `HOME` | Isolates too, but moves everything else that reads `HOME`: git identity, ssh config, package caches, the VS-704 ssh view. |
| `agy mcp add` into a scratch config | Only isolates in combination with this decision; on its own it writes into the owner's file, and concurrent workers race. |
| `agy acp` | Servers the ACP client passes are added to the user-level file, so `blender` still loads. It needs `--gemini_dir` anyway, brings a second protocol, and loses `--json-schema`. |

## Consequences

- A future agy that drops or changes `--gemini_dir` stops the runtime rather than leaking the
  owner's servers into workers.
- Each agent's conversations live in its own `.agy`, so `--conversation <id>` resumes only with
  the same dir. The adapter always passes it.
- Every agy run reports provider `antigravity` and declares `estimateCostByModel: false`. A Claude
  model reached through agy is therefore never priced at Anthropic API rates, and never merged with
  the `claude` runtime's rows in the usage breakdown.
