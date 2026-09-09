# cursor-runtime/adapter Specification

## Purpose
Defines Cursor CLI as a local coding-CLI runtime: how a worker or the conductor is launched through `cursor-agent` in the daemon-owned worktree, how a human's mid-turn message is injected on the same open-stdin channel Claude uses, how MCP and sessions are wired, and the hard ban on Cloud Agent handoff and Cursor `--worktree` checkouts.

## Requirements

### Requirement: Cursor is a first-class local runtime

The system SHALL register a runtime with id `cursor` that implements the same adapter contract as `claude`, `codex`, `opencode` and `gemini`. A role, project or workspace model setting MAY select runtime `cursor`. The workspace default SHALL remain unchanged. Detect SHALL look for the `cursor-agent` binary. A missing binary SHALL be reported as `missing_binary` and SHALL NOT be fatal.

#### Scenario: The daemon lists cursor

- **WHEN** the daemon starts with the cursor runtime package present
- **THEN** `GET /api/runtimes` includes an entry with id `cursor`
- **AND** Settings and `conductor runtime list` can select it the same way as the other four

#### Scenario: The binary is missing

- **WHEN** `cursor-agent` is not on PATH
- **THEN** detection status is `missing_binary`
- **AND** the daemon still starts

#### Scenario: Cursor is not the default

- **WHEN** a workspace has no explicit runtime override
- **THEN** the default runtime remains `claude`

### Requirement: Turns run locally through cursor-agent print mode

A turn on runtime `cursor` SHALL spawn `cursor-agent` through `launchCommand` in the agent's existing cwd (the daemon-provided home / worktree). The invocation SHALL use non-interactive print mode (`-p` / `--print`) with `--output-format stream-json`, `--trust` and `--force` (or `--yolo`). Unless live input is turned off, the prompt SHALL be the first NDJSON `user` frame on stdin, not an argv operand. File edits SHALL land in that cwd. The spawn SHALL NOT use ACP (`cursor-agent acp`) and SHALL NOT start `cursor-agent worker`.

#### Scenario: A new turn

- **WHEN** a worker on runtime `cursor` takes a first turn
- **THEN** the child command is `cursor-agent`
- **AND** the args include `-p` (or `--print`) and `--output-format stream-json`
- **AND** the args include `--trust` and `--force` or `--yolo`
- **AND** cwd is the daemon-provided agent home

#### Scenario: ACP is not the integration path

- **WHEN** a turn is launched
- **THEN** the args do not contain `acp`

#### Scenario: A private cloud worker is not started

- **WHEN** a turn is launched
- **THEN** the args do not contain `worker`

### Requirement: A human's message reaches the executing turn on open stdin

Where live input is on (the workspace default), a cursor turn SHALL declare `streamingInput` and SHALL keep the child's stdin open for the turn's lifetime, the same contract Claude uses (VS-99). The turn prompt SHALL be written as the first NDJSON `user` frame:

`{"type":"user","message":{"role":"user","content":"<text>"}}`

A `TurnHandle.send` SHALL write another such frame while the turn has not yet emitted its terminal `result` line, and SHALL report `delivered` when the write succeeded. After the `result` line, stdin SHALL be closed so the process can exit, and a later `send` SHALL report `closed`. When `defaults.liveInput` is false, the adapter SHALL omit `send`, SHALL NOT claim a live channel, and MAY pass the prompt as an argv operand instead.

The adapter SHALL NOT prefix a live-input frame with `&`. The existing `agent-attach/live-input` delivery and queued-fallback behaviour SHALL apply unchanged once `streamingInput` is true and `send` is present.

#### Scenario: The prompt is the first stdin frame

- **WHEN** `buildArgs` runs with live input on
- **THEN** the prompt is not an argv operand
- **AND** stdin is one NDJSON `user` frame whose `message.content` is the prompt text
- **AND** the args do not include `--continue`, `acp`, or `worker`

#### Scenario: A mid-turn send is delivered

- **WHEN** a turn is executing on runtime `cursor` with live input on, and a human sends text to that agent
- **THEN** `TurnHandle.send` writes a second `user` frame to the open stdin
- **AND** the outcome is mid-turn delivery, not a queued next-turn wake

#### Scenario: Stdin closes on the result line

- **WHEN** the CLI emits a terminal `result` event
- **THEN** the adapter ends stdin
- **AND** a subsequent `send` reports `closed`

#### Scenario: Live input can be turned off

- **WHEN** the turn is launched with `liveInput: false`
- **THEN** the handle has no `send`
- **AND** capabilities still describe the runtime, but this turn does not open a live channel

### Requirement: Cloud Agent handoff is never used

The adapter SHALL NOT send a task to Cursor Cloud Agents. It SHALL NOT prefix the prompt with `&`. It SHALL NOT pass a flag that triggers Cloud Agent handoff. It SHALL NOT call cursor.com/agents. A prompt that already begins with `&` SHALL be passed through unchanged as ordinary text — the adapter SHALL NOT add a second `&`, and SHALL NOT strip user text — but it SHALL NOT itself introduce the handoff prefix.

#### Scenario: Spawn args cannot trigger handoff

- **WHEN** `buildArgs` is called for any turn
- **THEN** the args contain no cloud-handoff flag
- **AND** the args do not contain `worker`
- **AND** neither the args nor the constructed prompt start with `&`

#### Scenario: The adapter does not prefix the prompt

- **WHEN** the turn prompt is `refactor the auth module`
- **THEN** the text given to `cursor-agent` does not start with `&`

#### Scenario: No call to cursor.com/agents

- **WHEN** a turn runs
- **THEN** the spawn does not target cursor.com/agents as a command or URL argument

### Requirement: Cursor CLI worktrees are never created

The adapter SHALL NOT pass `--worktree`, `-w` or `--worktree-base`. File edits SHALL stay in the daemon-provided worktree. Values in `extraArgs` that are `--worktree`, `-w` or `--worktree-base` (and the value that follows a flag that takes one) SHALL be dropped.

#### Scenario: Default invocation has no worktree flag

- **WHEN** `buildArgs` is called with no extraArgs
- **THEN** the args contain neither `--worktree` nor `-w` nor `--worktree-base`

#### Scenario: extraArgs cannot sneak a worktree in

- **WHEN** `options.extraArgs` includes `--worktree` or `-w`
- **THEN** those flags and any following worktree name are not present in the spawn args

### Requirement: MCP points at the run endpoint

Before each turn that has MCP servers, the adapter SHALL write `.cursor/mcp.json` in the agent cwd so Cursor CLI loads the same per-run HTTP MCP server other adapters receive (`/mcp/runs/<runId>`). The adapter SHALL pass `--approve-mcps` so those servers are not blocked on a prompt. MCP approval tokens in the written config SHALL allow the AgentConductor server's tools.

#### Scenario: A turn with the control-plane MCP

- **WHEN** a turn is given an HTTP MCP server named `agentconductor` at `http://127.0.0.1:7777/mcp/runs/run-1`
- **THEN** `.cursor/mcp.json` in cwd lists that server at that URL
- **AND** the spawn args include `--approve-mcps`

#### Scenario: No MCP servers

- **WHEN** a turn is given no MCP servers
- **THEN** no `.cursor/mcp.json` is required for that turn

### Requirement: Sessions resume; forks are not claimed

A new turn SHALL persist the `session_id` the CLI reports. A later turn on the same ticket SHALL pass `--resume <session_id>`. The adapter SHALL NOT claim `forkSessions`: Cursor CLI has no fork flag analogous to Claude's `--fork-session`. `--continue` SHALL NOT be used (it is an alias for the latest chat, not a specific id).

#### Scenario: Resume a stored session

- **WHEN** the turn's session ref carries a session id
- **THEN** the args include `--resume` and that id
- **AND** the args do not include `--continue`

#### Scenario: A new session has no resume flag

- **WHEN** the turn has no session ref
- **THEN** the args do not include `--resume` or `--continue`

#### Scenario: Fork is not offered

- **WHEN** the adapter's capabilities are read
- **THEN** `forkSessions` is false
- **AND** `forkSession` is omitted

### Requirement: Instructions and skills use Cursor discovery files

`installInstructions` SHALL write `AGENTS.md` at the agent home root (Cursor CLI reads `AGENTS.md` and `CLAUDE.md` as project rules) and SHALL copy skills into `.cursor/skills`. System prompt injection SHALL be `file_only`. A `CLAUDE.md` pointer MAY be written as `@AGENTS.md` so both discovery names resolve to the same charter.

#### Scenario: A worker home is installed

- **WHEN** `installInstructions` runs for a worker home
- **THEN** `AGENTS.md` at the home root contains the instruction bundle
- **AND** each skill is copied under `.cursor/skills/<name>/`

### Requirement: Models are listed without spending tokens

`listModels` SHALL return a static list of Cursor CLI model ids the adapter maintains (at least `auto` plus the current frontier aliases documented for the CLI). It SHALL NOT spawn `cursor-agent` to list models. `describeAccount`, if implemented, SHALL NOT spawn the CLI and SHALL NOT spend model tokens. `readCredential`, if implemented, SHALL read the credential file only and SHALL never return a token.

#### Scenario: listModels does not spawn

- **WHEN** `listModels` is called
- **THEN** it returns a non-empty static list
- **AND** no `cursor-agent` process is started

#### Scenario: Credential facts carry no token

- **WHEN** `readCredential` is called on a config home that holds `auth.json`
- **THEN** the result is `{ present, expiresAt }` with no token-bearing field

### Requirement: Verification never uses the owner's live Cursor login

Adapter tests SHALL drive `buildArgs` as a pure function and the event parser against recorded or synthetic fixtures. Spawn-path tests SHALL use a fake `cursor-agent` binary and a scratch config directory. Tests SHALL NOT invoke the real `cursor-agent` against host credentials.

#### Scenario: Args tests do not spawn

- **WHEN** the args unit tests run
- **THEN** they assert on the returned command, args, env, files and prompt
- **AND** they do not execute `cursor-agent`

#### Scenario: Parser tests use fixtures

- **WHEN** the event parser tests run
- **THEN** they feed lines from `fixtures/*.jsonl`
- **AND** they do not execute `cursor-agent`
