## Context

`agy` 1.5.14 is installed at `/home/v/.local/bin/agy`. It is a stripped Go binary (273 MB) that embeds its own changelog. This change must never run it against the owner's live login. So every fact below comes from one of three sources:

1. **Static reading** of the binary: `strings`, and the embedded changelog via `agy changelog`.
2. **Running the real binary inside `bwrap`** with `--unshare-all` (no network), a tmpfs in place of `/home/v` (the owner's `~/.gemini` and keyring files are not visible), no `DBUS_SESSION_BUS_ADDRESS`, and an empty `XDG_RUNTIME_DIR`. In that sandbox the binary cannot reach any credential, so it is not a run "against live credentials". Commands run there: `--version`, `--help`, `acp --help`, `mcp --help`, `mcp add --help`, `mcp list`, `changelog`, and `-p` with no login.
3. **The ticket's own `agy models` capture**, for the model ids.

| Fact | Evidence | Status |
|---|---|---|
| `--settings` cannot carry MCP servers | sandbox: `agy -p /config --settings '{"mcpServers":{"x":{"command":"true"}}}'` → `Error: --settings: unknown setting "mcpServers"`, exit 1 | verified |
| MCP servers come only from `<gemini dir>/config/mcp_config.json` (plus plugins) | changelog: "managing MCP servers in your user-level `mcp_config.json`"; sandbox `mcp list` reads the seeded file | verified |
| Hidden root flag `--gemini_dir` relocates the whole `.gemini` tree | sandbox: seeded `~/.gemini/config/mcp_config.json` with `captains-personal` and `/tmp/h/alt/config/mcp_config.json` with `weave`; `agy mcp list` → `captains-personal`; `agy --gemini_dir /tmp/h/alt mcp list` → `weave` only. A `-p` run with `--gemini_dir /tmp/h/wk` created `wk/antigravity-cli/{conversations,log,…}` and `wk/config/…`, and nothing under `~/.gemini` | verified |
| `--gemini_dir` must precede the subcommand | `agy mcp list --gemini_dir …` → `flags provided but not defined: -gemini_dir` | verified |
| The owner's default config already holds a personal MCP server | `jq 'keys'` on `~/.gemini/config/mcp_config.json` → `blender` (names only, nothing else read) | verified |
| Login is stored in the OS keyring when a session bus exists; otherwise in a file | sandbox log: `Using file-based token storage because no D-Bus session bus detected`; changelog: "bypasses the keyring when no D-Bus session bus is present". The daemon's environment has `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus` and gnome-keyring is running | verified (the live keyring item itself was not read) |
| Headless with no login blocks 60 s | sandbox: stderr `Authentication required. Please visit the URL to log in:` + URL, `Waiting for authentication (timeout 60s)...`; after 60 s `Error: authentication timed out.` / `error: authentication failed or timed out`, exit 1, and the stdout result event `{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"authentication failed or timed out",…,"finished_reason":"error"}}` | verified (captured bytes) |
| `--model`/`--effort` interplay | changelog: `--effort` does "variant selection"; base names without `--effort` pick a default level. What `gemini-4-neon-high --effort low` does is **not established** — it needs a logged-in run | unverified, designed around |
| `--json-schema` root must be `"type":"object"`; for `stream-json` it applies to the final `result`; the result carries `structured_output` | `--help`; changelog; struct tag `json:"structured_output,omitempty"` | verified statically |
| Resume: `--conversation <id>`; the result carries `conversation_id` | `--help`; captured result event | verified (field present, value empty without login) |
| Workspace instruction files are `AGENTS.md`/`GEMINI.md`; workspace skills live in `.agents/skills/` | changelog entries for rules and `.agents/skills/` | verified statically |

## Goals / Non-Goals

**Goals:** an `agy` worker can complete a ticket end to end. Its MCP surface is the weave server alone. Its sessions resume. Its report is schema-enforced. An `agy` login failure reaches the login gate quickly and visibly. Captain can pick Neon/Argon/Hydrogen/Orchestrator per ticket.

**Non-Goals:** live mid-turn input (`--input-format stream-json`); `agy acp`; a usage/limits probe; routing Claude or GPT-OSS models through `agy`; the remote-agent, sandbox or swarm features.

## Decisions

### 1. MCP isolation: per-agent `--gemini_dir` (recommended) — options considered

`--settings` was the hoped-for answer, and it does not work (see table). These are the options that remain:

| Option | Leak-proof? | Resume works? | Cost / risk |
|---|---|---|---|
| **A. `--gemini_dir <agent home>/.agy` on every invocation; adapter rewrites `config/mcp_config.json` each turn** | Yes. The owner's `~/.gemini` (MCP, plugins, hooks, global `GEMINI.md`/`AGENTS.md`, skills) is never read. | Yes. Conversations live in the same dir across turns. | Relies on a flag missing from `--help`. Mitigated by the `detect()` self-check (`mcp list` against a seeded scratch dir, no login or network needed), which refuses the runtime if the flag stops isolating. |
| B. Per-worker `HOME` | Yes | Yes | Moves everything else that reads `HOME` too (git identity, ssh config, npm/pnpm caches, the VS-704 ssh view), so other behaviour breaks. Plugin secrets under `~/.config/antigravity` move with it. |
| C. `agy mcp add` into a scratch config | Only if combined with A or B; on its own it writes into the owner's file | — | A config-file mutation with races between concurrent workers. Strictly worse than A. |
| D. `agy acp` (ACP stdio server; the client passes MCP servers per session) | **No** on its own. ACP-provided servers are added to the user-level `mcp_config.json`, so `blender` would still load. It needs A anyway. | Yes (`session/resume`) | A second protocol (JSON-RPC, permission round-trips). No `--json-schema` flag on `acp`, so the report loses schema enforcement. |

A gives the strongest guarantee for the least machinery. If a future `agy` adds `--mcp-config`, A still holds, and the adapter can switch with no behaviour change.

`--gemini_dir` is always passed as an **absolute** path: a relative value resolved to `$HOME/<value>` in the sandbox, where cwd and `HOME` coincided, so that test could not tell them apart.

### 2. Authentication: the keyring login is shared, and failures are caught on stderr

With a session bus present (the daemon's case), `agy` reads the login from the gnome-keyring item for the OS user. That item does not depend on `--gemini_dir`, so per-agent dirs keep the one shared login, the same way the workspace runtime homes share one Claude credential. Google OAuth refresh tokens do not rotate on use the way Claude's do. Concurrent workers therefore should not invalidate each other. That is **inferred, not verified**, and the owner capture (§5) checks the shared-login part.

There is no credential file to read, so the adapter implements no `readCredential`. The accounts service then reports presence by the runtime home's existence and expiry as unknown. That is the existing reader-less path, which `gemini` already takes. Detection therefore happens at turn time:

- A stderr line starting `Authentication required.` → `run.cancel('kill')` immediately, then error `{ code: 'auth', family: 'auth', message: 'agy is not logged in (run `weave runtime login agy`)' }`. The raw stderr is not passed to `classifyError`. The OAuth URL's random `state`/`code_challenge` can contain `429`, `401` or `503`, which `classifyError`'s quota and transient patterns would match first.
- A result `error` of `authentication failed or timed out`, or an `Authentication expired` message (changelog: "the agent now says `Authentication expired. Please log back in.`") → the same `auth` error.

Everything downstream already exists: `engine.ts` gates on repeated `auth` failures, and `authgate.ts` handles the card, channel, incident and recovery. `NATIVE_LOGIN.agy = 'agy'`, and `weave runtime login agy` runs `agy` interactively (its first-run OAuth). The periodic re-check cannot observe a changed credential (no reader), so it never auto-releases `agy`. Release comes from a successful turn or the operator's manual re-check, as for `gemini`.

### 3. Isolated daemons must not reach the keyring

An isolated daemon (VS-143) promises that a runtime never resolves to the owner's credential. For `agy` that credential is the keyring, not a file. So for runtime `agy` on an isolated daemon, the engine removes `DBUS_SESSION_BUS_ADDRESS` and sets `XDG_RUNTIME_DIR` to an empty dir under the run dir. Without the second step, a client could find `/run/user/<uid>/bus` by default. With no session bus, `agy` logs `Using file-based token storage because no D-Bus session bus detected`, which was verified in the sandbox. A scratch daemon's agy turn then fails with `auth` rather than spending the owner's account. The engine owns this, not the adapter, because only the engine knows `ctx.isolated`. It is a small per-runtime env hook beside `turnSshPath`.

### 4. Effort is folded into the model id; `--effort` is never sent

The catalog carries `runtime`, `model` and `effort` separately. `agy` encodes effort in the id and also takes `--effort`, and which one wins when they disagree is unestablished. The adapter therefore never sends both:

| `model` | `effort` | `--model` sent |
|---|---|---|
| `gemini-4-neon` | `high` | `gemini-4-neon-high` |
| `gemini-4-argon` | `xhigh` | `gemini-4-argon-high` (highest offered ≤ requested) |
| `gemini-4-hydrogen` | — | `gemini-4-hydrogen-medium` |
| `gemini-4-neon-high` | `low` | `gemini-4-neon-high` (a full id wins; effort ignored) |
| `gemini-pro-orchestrator-neon` | any | unchanged |

Families and efforts, from the ticket's `agy models` capture:

| Family | Efforts |
|---|---|
| Neon | low/medium/high/xhigh |
| Argon | low/medium/high |
| Hydrogen | low/medium/high/xhigh |
| Gemini 3.8 Flash | low/medium/high |
| Orchestrator (Neon) `gemini-pro-orchestrator-neon` | none |
| Orchestrator (Argon) `gemini-pro-orchestrator-g1-pro` | none |

The list is `static`, like Claude's. `agy models` needs a login and the network, so it is not called from `listModels()`.

### 5. Event parser fixtures come from one owner-run capture

The success-path `stream-json` events (init, assistant text, tool call and result, final result with usage and `structured_output`) cannot be produced without a login. A hand-written fixture would only encode a guess (the VS-186/VS-214 rule). So apply begins with `scripts/capture-agy-fixtures.sh`, which the owner runs once on the daemon host. It:

- uses a fresh `--gemini_dir` under `/tmp` with one trivial stdio MCP server (a 20-line echo server shipped beside the script);
- runs turn 1 (`-p`, `stream-json`, `--json-schema`) asking for one MCP tool call, then turn 2 with `--conversation <id from turn 1>`;
- runs `-p /model` twice: once with `--model gemini-4-neon-high --effort low`, and once with `--model gemini-4-neon --effort high`. These are read-only slash commands that use no model tokens. They settle the `--effort` question for the record and check that the shared keyring login works under a relocated `--gemini_dir`;
- writes everything to a directory the owner attaches back to the ticket, with OAuth URLs and tokens redacted by the script.

The parser and its `fixtures/*.jsonl` are written from those bytes. Until the capture exists, the parser task stays open: the worker asks the weaver through `weave_ask` and does not guess.

### 6. Instructions and skills

`installInstructions` writes `AGENTS.md` (agy reads workspace `AGENTS.md` rules) and installs skills under `.agents/skills/`. The weave worker-denied scheduling tools have no `agy` equivalent identified, so `workerDeniedTools` stays empty until the capture shows the tool list from the `init` event.

### 7. Permissions

| Our mode | Flag |
|---|---|
| `bypass` | `--dangerously-skip-permissions` |
| `auto` | `--mode accept-edits` |
| `restricted` | `--mode plan` |

A headless run soft-denies a tool that needs approval and reports `denied_actions`; the adapter records those as a warning event.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| `--gemini_dir` is undocumented and could change | The `detect()` self-check refuses the runtime instead of leaking; the ADR records it; the version is pinned in the PR text |
| One keyring login shared by every agy agent and the owner's own `agy` | Same shape as the existing one-credential-per-runtime model; Google tokens are not single-use (inferred) |
| An expired login fails three turns before the gate (engine threshold) | Each fails in under a second instead of 60 s; the threshold is unchanged and shared with Claude |
| The success-path event shapes are unknown until the capture | Task order makes the capture a gate for the parser; nothing is guessed |
| The worker-option catalog is capped at 16 entries | Four entries are proposed (`agy-neon`, `agy-argon`, `agy-hydrogen`, `agy-orchestrator`), each choosing an effort; captain can add more |

## Migration Plan

Additive. After `weave daemon upgrade`, captain (or the weaver, on request) adds the four worker options through the models settings, with these descriptions:

| Option | Runtime / model / effort | Description |
|---|---|---|
| `agy-neon` | `agy` / `gemini-4-neon` / `high` | Gemini 4 Neon via Antigravity |
| `agy-argon` | `agy` / `gemini-4-argon` / `high` | Gemini 4 Argon via Antigravity |
| `agy-hydrogen` | `agy` / `gemini-4-hydrogen` / `high` | Gemini 4 Hydrogen via Antigravity |
| `agy-orchestrator` | `agy` / `gemini-pro-orchestrator-neon` | Orchestrator (Neon) via Antigravity |

The end-to-end acceptance run (a real ticket on an agy model) happens after the upgrade: a worker cannot run the live CLI from its own ticket.

## Open Questions

- What `--effort` does against a conflicting variant id. The design does not depend on the answer; the capture records it.
- Whether `agy` exposes a tool equivalent to a turn-scoped scheduler that workers must be denied. To be read from the capture's `init` tool list.
