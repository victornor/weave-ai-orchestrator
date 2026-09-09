## Context

See `proposal.md` for motivation. Existing adapters live in `packages/runtimes/{claude,opencode,gemini,codex}` and implement `RuntimeAdapter`. Cursor CLI (docs read 2026-09-09: https://cursor.com/docs/cli/overview, using, parameters, headless, authentication, configuration, output-format, permissions, MCP) is the `cursor-agent` binary — captain correction 2026-09-09: invoke as `cursor-agent`, not `agent`. On this host both names are symlinks to the same script (`~/.local/share/cursor-agent/versions/2026.09.08-6caf4ff/cursor-agent`); the adapter still detects and launches `cursor-agent` only.

The role forbids launching any coding CLI against live credentials. Nothing below was established by running `cursor-agent`. Flag names come from the published docs plus a `strings`/`rg` pass over the installed `index.js` bundle (same method as VS-99 / VS-129). Stream-json event shapes come from the published output-format page. Credential file location (`~/.config/cursor/auth.json`, `CURSOR_CONFIG_DIR`) comes from the configuration docs. Live CLI behaviour that those sources do not pin is marked unverified in the PR.

## Goals / Non-Goals

**Goals:**
- A fifth runtime package, print-mode spawn and stream-json parser like Gemini, **live stdin like Claude** (VS-99): `streamingInput: true`, first prompt as a `user` frame, `send()` for mid-turn attach.
- Hard guards in `buildArgs` so Cloud Agent handoff and Cursor `--worktree` cannot leak in, including via `extraArgs` and via live-input frames.
- Host credential sharing for `cursor` via the existing VS-75 symlink machinery.
- Synthetic fixtures transcribed from the published stream-json schema, labelled as such (Gemini's pattern). Fake-CLI live-input tests matching `packages/runtimes/claude/test/liveInput.test.ts`.

**Non-Goals:**
- Cursor Cloud Agents as a runtime, ACP, `cursor-agent worker`.
- Making Cursor the workspace default.
- Changing how the other four adapters launch.
- Dynamic `cursor-agent models` / `--list-models` (would spawn the real CLI).
- Claiming `forkSessions`.
- Changing `agent-attach/live-input` (cursor opts into that contract; the delivery/queue/UI already key off `streamingInput` + `send`).
- `conductor doctor --install` for cursor (install is `curl https://cursor.com/install | bash`, not an npm package; leave as a missing-binary doctor row with a manual fix).

## Decisions

### Binary name is `cursor-agent`

Captain, 2026-09-09: "Cursor CLI is invoked as `cursor-agent`, not `agent`." Detect, `launchCommand`, fake-binary tests and spawn args all use `cursor-agent`. The docs still say `agent`; that is the product's own alias. We do not detect `agent` as a fallback — two names would make PATH resolution and fake-binary tests fork.

### Print-mode spawn, not ACP

Ticket out of scope: "ACP (`agent acp`) as the integration path — this is a RuntimeAdapter, not an ACP client." Headless docs: `cursor-agent -p --force --output-format stream-json`. We add `--trust` (headless workspace trust) and `--approve-mcps` (otherwise MCP tools prompt). Permission `auto`/`bypass` → `--force`/`--yolo`; `restricted` omits `--force` so writes stay proposed (headless docs: without `--force`, changes are only proposed). Sandbox: `restricted` → `--sandbox enabled`; `auto`/`bypass` → `--sandbox disabled`.

`--output-format json` (single object at end) was considered and rejected: the other adapters stream events into the transcript live; stream-json is the matching contract.

### Live stdin matches Claude's frames (revision 2026-09-09)

Captain's plan revision: a human must be able to inject a message into a running cursor worker the way Claude already does — immediately, not queued for the next turn.

How Claude does it (ADR 0012, `packages/runtimes/claude`): every turn is `-p --output-format stream-json --input-format stream-json`, the prompt is `userFrame(text)` on stdin, `spawnLines({ stdinMode: 'open' })`, `TurnHandle.send` writes another frame, stdin closes on the `result` line. `workers.message()` / attach already call `send()` iff `capabilities.streamingInput` and the active run has `send`. Codex/OpenCode/Gemini leave `streamingInput: false`, so attach reports queued.

Cursor evidence, established without launching the CLI (same method as VS-99):

- Published flags (parameters page + `index.js` help strings, CLI 2026.09.08-6caf4ff): `-p/--print`, `--output-format text|json|stream-json`, `--stream-partial-output`. **No `--input-format`.** `stream-json` appears twice in the bundle, both in the `--output-format` help line.
- Output-format docs: print mode is inferred when stdout is non-TTY **or stdin is piped**. The published `user` *output* event is `{type:"user", message:{role:"user", content:[{type:"text", text:"…"}]}}`.
- `process.stdin` hits in the bundle are Ink raw-mode / TTY pickers and an internal JSON-line writer to a child — not a documented input-frame parser.

Decision: **still open the Claude-shaped channel.** Stdin cannot be reopened mid-process (ADR 0012), so "discover whether Cursor honours follow-up frames on a live CLI" is not a reason to spawn without a channel. The adapter:

- `streamingInput: true`
- `userFrame(text)` identical to Claude's: `{"type":"user","message":{"role":"user","content":"<text>"}}\n` (string `content`, not the output-side array). Captain asked for Claude's stdin frames; one helper, one test assertion.
- Prompt is that first frame; never an argv operand when live input is on (no ARG_MAX issue, nothing leaks into `ps`).
- `stdinMode: 'open'`; `send()` writes another `userFrame`; close stdin when the parser sees `result` (`resultSeen`).
- `defaults.liveInput === false` restores argv prompt + closed stdin + no `send`, same escape hatch as Claude.
- Live frames go through the same `&` / `--worktree` guards: `send` MUST NOT prefix `&`; extraArgs still cannot inject `--worktree`.

Unverified against the real CLI (charter rule): whether print-mode `cursor-agent` consumes a second stdin `user` frame as a follow-up rather than ignoring it or treating it as Cloud-handoff. Fake-CLI tests prove *our* spawn/send/close contract. If the first live deploy shows frames ignored, `send` still returns `delivered` only when the write succeeded — the CLI not acting on them is a follow-up, not a reason to queue every message by declaring `streamingInput: false` up front.

Alternative considered: leave `streamingInput: false` (first proposal). Rejected — that is exactly the gap captain called out; attach would only ever queue.

Alternative considered: ACP (`cursor-agent acp`) as the live channel. Rejected — ticket out of scope.

### The `&` guard (args and live frames)

The Cloud Agent handoff trigger is a message that *starts with* `&`. `buildArgs` and `userFrame` therefore:
- never prefix `&` on the first frame or on `send`
- never pass a cloud-handoff / `worker` subcommand
- pass user text through even if it happens to start with `&` (we do not silently rewrite the wake digest)
- reject `--worktree`, `-w`, `--worktree-base` from `extraArgs` (flag plus following value)

### MCP via `.cursor/mcp.json` in cwd

Cursor loads MCP from `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global). There is no `--mcp-config` flag. Same pattern as OpenCode (`.opencode/opencode.json`) and Gemini (`.gemini/settings.json`): `buildArgs` writes cwd `.cursor/mcp.json` for the turn. HTTP servers use `{ url, headers }`. `--approve-mcps` auto-approves them. Bearer tokens stay in the file (OpenCode/Gemini do the same); they are already in the MCP config the daemon handed us.

Skills dir: `.cursor/skills` (Cursor's project skills path). Instruction files: `['AGENTS.md']` — Cursor reads AGENTS.md and CLAUDE.md at the project root. Write AGENTS.md as the charter; optionally CLAUDE.md as `@AGENTS.md\n` (Claude adapter's pointer trick). Spec allows the pointer; implement it so a CLI that prefers CLAUDE.md still sees the charter.

### Config home is `CURSOR_CONFIG_DIR`

Docs: `CURSOR_CONFIG_DIR` overrides the directory that holds `cli-config.json`; else `XDG_CONFIG_HOME/cursor/cli-config.json` or `~/.cursor/cli-config.json`. On this host the live files are `~/.config/cursor/{cli-config.json,auth.json}` (XDG) plus a smaller `~/.cursor/agent-cli-state.json`. Adapter env: `CURSOR_CONFIG_DIR=<workspace>/.agent-conductor/runtimes/cursor`. That isolates settings and sessions per workspace.

Credential pair for `credentialPaths`:
```
cursor: [[join(h, '.config', 'cursor', 'auth.json'), join(home, 'auth.json')]]
```
`auth.json` is what `agent login` writes (accessToken / refreshToken JWT). Isolated daemons already remap the host side to `<configDir>/credentials/cursor/auth.json`.

`readCredential`: present iff `auth.json` exists; `expiresAt` from the JWT `exp` claim of `accessToken` when it is a JWT with a numeric `exp`, else null. Never return the token. Same "unreadable expiry is unknown, not expired" rule as Claude's setup-token case.

`describeAccount`: static, spawn-free. If `CURSOR_API_KEY` is in env → `metered_api`; if `auth.json` exists → `subscription_included`; else `unknown`. No plan-limit windows (CLI does not expose them to print mode). Matches Codex/Gemini.

Do **not** symlink `cli-config.json` from the host — that file holds UI preferences, not the rotating credential. Sharing it would mix the owner's approvalMode/sandbox into every agent turn.

### Sessions: `--resume <id>`, no fork, no `--continue`

`--resume [chatId]` resumes a specific session; `--continue` is `--resume=-1` (latest). Always pass the stored id. Session ref is `{ sessionId: string }` from the stream's `session_id`. `forkSessions: false`, no `forkSession` method (Gemini's pattern). `create-chat` is not used — the CLI allocates the id on first print-mode run.

### Models: static list, no spawn

`--list-models` / `cursor-agent models` would spawn the real CLI. Static list, `source: 'static'`, ids from the 2026-09-09 docs model catalogue and the CLI's `/model` examples: `auto`, `gpt-5`, `sonnet-4-thinking`, plus current Cursor-router aliases that the docs name (`composer-2-5` if listed). No `contextWindowTokens` until we have a catalog we can read without spawning (omit the field; meter already says "unknown"). Revisit later the way VS-129 did for Claude.

### Event parser from published stream-json

Cursor print-mode NDJSON (docs): `system/init`, `user`, `assistant` (full message between tools; with `--stream-partial-output`, skip duplicates that have `model_call_id` or lack `timestamp_ms`), `tool_call` started/completed (`readToolCall` / `writeToolCall` / `function`), terminal `result`. Map:

| Cursor event | RuntimeEvent |
|---|---|
| system/init | `session.started` or `session.resumed` |
| assistant (text) | `assistant.text` |
| tool_call started | `tool.call` |
| tool_call completed | `tool.result`; `command.executed` / `file.changed` when the tool is shell/write |
| result | `turn.completed`; `finalText` from `result` |
| unknown | `runtime.raw` |

Do not pass `--stream-partial-output` for v1 (one assistant event per message is enough; deltas would need the skip table). Usage: the published `result` object has no token counts — `usageReporting: 'none'`, `costReporting: false`. If a later CLI adds usage on `result`, the parser can start filling it without a contract change.

Fixtures: synthetic, transcribed from the docs' example sequence, same disclaimer Gemini uses. A live recording is a follow-up the owner can drop in.

### Registration and login fallback

Same mechanical list as the other four:

- `packages/runtimes/cursor/package.json` → `@agent-conductor/runtime-cursor`
- root `tsconfig.json` reference
- `packages/server` dep + `RUNTIME_PACKAGES`
- `scripts/guard-boundaries.mjs` add `@agent-conductor/runtime-cursor` to core's forbid list
- `skills/manifest.json` `"cursor": { "path": ".cursor/skills/<name>/SKILL.md" }`
- `packages/cli/src/commands/runtime.ts` `FALLBACK.cursor = { env: 'CURSOR_CONFIG_DIR', command: ['cursor-agent', 'login'], instructions: ['…'] }`
- `credentialPaths` as above
- Docs: PLAN §8 table row, OPERATIONS credential table, CLAUDE.md runtimes list, DOCKER.md auth row

Settings / `conductor runtime` need no special case: they iterate the registry. UI tests that hardcode four runtimes stay as they are.

`conductor doctor --install`: do not add `cursor` to `InstallableId`. Install is a curl-to-bash script, not npm; a missing binary already gets a doctor row with `conductor runtime login cursor` as the login afterthought only if we added it to that array — leave login as the FALLBACK path the human runs themselves.

### launchCommand, not a bare spawn

VS-73: every runtime CLI spawn, including `detect` (already `detectBinary`) and `runTurn`, goes through `launchCommand` so PATH + fallback dirs (mise shims, `~/.local/bin`) resolve `cursor-agent`. Do not copy OpenCode's `spawnLines` with only `built.env` overlay — that was the PATH-empty bug.

## Risks / Trade-offs

- **Prompt or a mid-turn frame starting with `&` still reaches the CLI** → the CLI might treat it as handoff. Mitigation: we never introduce `&`; rewriting user text is a bigger lie. If a live check later shows print-mode honours `&`, add a leading-`&` escape then as a follow-up. Mark unverified in the PR.
- **Real `cursor-agent` may ignore follow-up stdin frames** (no `--input-format` in the binary). Mitigation: we still open the channel so attach is honest; fake-CLI tests lock our contract; PR labels the live consume-on-follow-up as unverified. Do not silently fall back to `streamingInput: false`.
- **`--force` in print mode has full write access** (docs). Matches `permission.mode === 'auto'`, which is how Codex/OpenCode/Gemini already run unattended. `restricted` omits `--force`.
- **JWT `exp` on `auth.json`** may be the session token, not a refresh expiry. If unreadable or missing, `expiresAt: null` — reconcile keeps the host file (VS-75 rule). Do not guess.
- **Synthetic fixtures drift from a future CLI** → parser tests still lock the mapping we implement; a live recording can replace them without changing the adapter contract.
- **`CURSOR_CONFIG_DIR` vs XDG layout** — docs mention both `~/.cursor/cli-config.json` and `$XDG_CONFIG_HOME/cursor/cli-config.json`. We set `CURSOR_CONFIG_DIR` explicitly, so neither default is consulted during a turn. Host credential path still uses `~/.config/cursor/auth.json` (XDG). If a host only has `~/.cursor/auth.json`, linking will no-op until they log in once; mention in OPERATIONS.

## Migration Plan

No migration. New package, empty credential pair until the owner runs `cursor-agent login` (or already has `~/.config/cursor/auth.json`). Rollback is revert the PR; registered runtime disappears, settings pointing at `cursor` become a missing runtime the same way an uninstalled `gemini` does today.

## Open Questions

None that change the spec or task breakdown. Live confirmation of (1) print-mode `&` handling, (2) whether a second stdin `user` frame is consumed as a follow-up, and (3) `CURSOR_CONFIG_DIR`/`auth.json` layout, is unverified and belongs in the PR, not a blocker.
