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

A turn on runtime `cursor` SHALL spawn `cursor-agent` through `launchCommand` in the agent's existing cwd (the daemon-provided home / worktree). The invocation SHALL use non-interactive print mode (`-p` / `--print`) with `--output-format stream-json`, `--trust` and `--force` (or `--yolo`). The prompt SHALL be an argv operand after `--` when it fits the argv budget, or closed plain-text stdin when oversized. The spawn SHALL NOT keep stdin open for NDJSON `user` frames. File edits SHALL land in that cwd. The spawn SHALL NOT use ACP (`cursor-agent acp`) and SHALL NOT start `cursor-agent worker`.

#### Scenario: A new turn

- **WHEN** a worker on runtime `cursor` takes a first turn
- **THEN** the child command is `cursor-agent`
- **AND** the args include `-p` (or `--print`) and `--output-format stream-json`
- **AND** the args include `--trust` and `--force` or `--yolo`
- **AND** cwd is the daemon-provided agent home
- **AND** the prompt is an argv operand after `--` (or closed plain-text stdin when oversized)
- **AND** stdin is not an NDJSON `user` frame

#### Scenario: ACP is not the integration path

- **WHEN** a turn is launched
- **THEN** the args do not contain `acp`

#### Scenario: A private cloud worker is not started

- **WHEN** a turn is launched
- **THEN** the args do not contain `worker`

### Requirement: A human's message reaches the executing turn on open stdin

Runtime `cursor` SHALL declare `streamingInput: false` and SHALL NOT expose `TurnHandle.send`. A cursor turn SHALL ignore workspace `defaults.liveInput` and SHALL NOT keep the child's stdin open. A human message sent while a cursor turn is executing SHALL queue for the next turn under the existing `agent-attach/live-input` contract for a runtime that does not offer a live channel.

The adapter SHALL NOT prefix the prompt with `&`.

#### Scenario: The prompt is the first stdin frame

- **WHEN** `buildArgs` runs for a cursor turn
- **THEN** the prompt is an argv operand after `--` (or closed plain-text stdin when oversized)
- **AND** stdin is not an NDJSON `user` frame
- **AND** the args do not include `--continue`, `acp`, or `worker`

#### Scenario: A mid-turn send is delivered

- **WHEN** a turn is executing on runtime `cursor` and a human sends text to that agent
- **THEN** the handle has no `send`
- **AND** the outcome is a queued next-turn wake, not mid-turn delivery

#### Scenario: Stdin closes on the result line

- **WHEN** a cursor turn is launched
- **THEN** stdin is already closed (or never opened as a live channel)
- **AND** the handle has no `send`

#### Scenario: Live input can be turned off

- **WHEN** the turn is launched with `liveInput: false` or with the workspace default `liveInput: true`
- **THEN** the handle has no `send`
- **AND** the prompt is still an argv operand or closed plain-text stdin, not an NDJSON `user` frame

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

`listModels` SHALL enumerate Cursor CLI's real, currently accepted model ids by invoking
`cursor-agent --list-models` and parsing its output into `RuntimeModel[]`, tagging each entry
`source: 'detected'`. This SHALL NOT start a model session, run a turn, or otherwise spend
model/LLM tokens — `--list-models` exits without producing assistant output. A successful result
SHALL be cached in the adapter's process and reused for calls within a bounded freshness window,
so a caller rendering a model picker repeatedly does not respawn the CLI on every render. `auto`
SHALL always be present in the returned list, added if the CLI's own output omitted it.

When `cursor-agent` is not on PATH, the `--list-models` call fails, times out, exits non-zero, or
its output cannot be parsed into at least one model id, `listModels` SHALL make exactly one attempt
(no retry, no second detection path) and SHALL then return a static fallback list of ids known to
have been valid as of this change (tagged `source: 'static'`) rather than returning an empty list
or throwing. Every returned id, from either path, SHALL be one `cursor-agent` actually accepts as
of the source it came from — no id SHALL be invented or hand-guessed. Every returned entry SHALL
carry a human-readable `label` distinct from its raw `id`.

Falling back SHALL be logged at `warn` with the reason (missing binary, non-zero exit, timeout, or
unparseable output) and a bounded excerpt of whatever `cursor-agent` printed, so the difference
between a live-detected catalogue and a stale fallback is reachable by a human reading the daemon
log rather than only present in the `source` field. The excerpt SHALL NOT include credentials.

`describeAccount`, if implemented, SHALL NOT spawn the CLI and SHALL NOT spend model tokens.
`readCredential`, if implemented, SHALL read the credential file only and SHALL never return a
token.

`buildArgs` SHALL pass `--model <id>` only when the resolved model is a non-empty string other
than `auto`. An unset model, an empty model, or `auto` SHALL omit `--model` so the CLI chooses.

A turn requesting a named model (not `auto`, not unset) SHALL compare that model against the model
`cursor-agent` reports on its `system`/`init` line once the session starts. The comparison SHALL
be family-word based (the requested id's first alphabetic run, matched case-insensitively as a
substring of the reported model) rather than exact-string, since the CLI's reported string is a
free-form display name not pinned by this adapter. When the reported model does not contain the
requested model's family word, the adapter SHALL interrupt the turn and SHALL report a
`TurnResult.error` with code `model_mismatch` rather than completing as an ordinary success. A
turn requesting `auto` or no model SHALL NOT be subject to this check.

When a turn fails because `cursor-agent` rejected the requested model outright (a message of the
form "Cannot use this model: `<id>`. Available models: `<list>`", where `<list>` may end in a
truncated `, ...`), the adapter SHALL parse the available-models list out of that message and
SHALL include it in the returned `TurnResult.error.message`, so the human sees the CLI's own
current catalogue rather than only the id that failed.

#### Scenario: listModels does not spawn

- **WHEN** `listModels` is called again before its previously cached result has expired
- **THEN** it returns that previous result (whether detected or fallback)
- **AND** no new `cursor-agent` process is started

#### Scenario: A cold cache detects the live catalog

- **WHEN** `listModels` is called with no cached result (or an expired one) and `cursor-agent
  --list-models` succeeds
- **THEN** the returned list is parsed from that output
- **AND** every entry's `source` is `detected`
- **AND** `auto` is present even if the CLI's own output did not include it

#### Scenario: Detection fails and the fallback answers instead

- **WHEN** `cursor-agent` is not on PATH, or `--list-models` exits non-zero, times out, or its
  output has no parseable model id
- **THEN** `listModels` returns the static fallback list
- **AND** every entry's `source` is `static`
- **AND** the returned list is never empty
- **AND** exactly one detection attempt was made — no retry, no second detection path

#### Scenario: A fallback is logged, not silent

- **WHEN** detection fails for any reason
- **THEN** a `warn`-level log records the reason and a bounded excerpt of the CLI's actual output
- **AND** the logged excerpt contains no credential

#### Scenario: Credential facts carry no token

- **WHEN** `readCredential` is called on a config home that holds `auth.json`
- **THEN** the result is `{ present, expiresAt }` with no token-bearing field

#### Scenario: Auto omits --model

- **WHEN** `buildArgs` runs with model `auto` or with no model
- **THEN** the args do not contain `--model`

#### Scenario: A named model is forwarded

- **WHEN** `buildArgs` runs with a named model id from the catalog other than `auto`
- **THEN** the args include `--model` and that id

#### Scenario: The CLI ran the requested model family

- **WHEN** a turn requests model `opus-5` and `cursor-agent`'s `system.init` line reports a model
  string containing "Opus"
- **THEN** the turn is not interrupted for a model mismatch
- **AND** it can complete as an ordinary success

#### Scenario: The CLI silently ran a different model

- **WHEN** a turn requests model `grok-4-6` and `cursor-agent`'s `system.init` line reports a
  model string that does not contain "grok" (for example a Claude/Opus display name)
- **THEN** the adapter interrupts the turn
- **AND** the returned `TurnResult.error.code` is `model_mismatch`

#### Scenario: Auto is exempt from the model check

- **WHEN** a turn requests model `auto` (or no model at all)
- **THEN** no model-mismatch check runs regardless of what `system.init` reports

#### Scenario: A rejection surfaces the real catalogue

- **WHEN** a turn fails with a message reading `Cannot use this model: grok-4-6. Available
  models: auto, gpt-5.2, cursor-grok-4.6-high-fast, ...` (a truncated list)
- **THEN** the returned `TurnResult.error.message` includes the parsed available ids
  (`auto`, `gpt-5.2`, `cursor-grok-4.6-high-fast`)
- **AND** parsing the trailing `, ...` does not throw or produce a bogus `"..."` entry

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

### Requirement: A silent process fails within seconds, not the full daemon watchdog window

`runTurn` SHALL track whether `cursor-agent` has written any line to stdout or stderr since it was spawned. If no such line has arrived within a short, adapter-local grace period — comfortably under the daemon's own `defaults.silenceTimeoutSec` floor — the adapter SHALL interrupt the process itself and SHALL report a `TurnResult.error` with code `no_output`, rather than relying solely on the daemon supervisor's generic silence watchdog (which defaults to 600 seconds).

#### Scenario: A completely silent spawn fails fast

- **WHEN** `cursor-agent` spawns and writes nothing at all to stdout or stderr before the adapter's own no-output grace period elapses
- **THEN** the adapter interrupts the process
- **AND** the returned `TurnResult.error.code` is `no_output`
- **AND** this happens well before the daemon's `silenceTimeoutSec` (minimum 60s, default 600s) would have fired

#### Scenario: Any output at all defers to normal completion

- **WHEN** `cursor-agent` writes at least one line to stdout or stderr before the grace period elapses
- **THEN** the no-output check never interrupts the turn
- **AND** the turn proceeds to its normal outcome

### Requirement: Model ids get a derived human-readable label

Every `RuntimeModel` this adapter returns SHALL carry a `label` derived algorithmically from its
`id` (its family word plus any recognized variant/tier suffix), not from a hand-maintained
id-to-label table. This SHALL apply equally to ids from `--list-models` and from the static
fallback, so a model id neither list's author anticipated still reads as something recognizable
rather than as a raw id.

#### Scenario: A known id reads as its brand name

- **WHEN** the id is `cursor-grok-4.6-high-fast`
- **THEN** the derived label contains "Grok 4.6"

#### Scenario: An unrecognized id still gets a readable label

- **WHEN** the id is one `--list-models` reports that matches no known family word
- **THEN** the derived label is a humanized form of the id (not the raw id string, and not empty)
