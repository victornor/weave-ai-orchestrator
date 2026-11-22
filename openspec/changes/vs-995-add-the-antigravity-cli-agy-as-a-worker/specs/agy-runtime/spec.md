## Purpose

Run Weave AI agents on Google's Antigravity CLI (`agy`) in print mode, with its Gemini 4 models selectable per ticket. A worker on `agy` sees the weave MCP server and none of the machine owner's own MCP servers, plugins, hooks or global rules. Its sessions resume across turns, its final report validates against the run's schema, and an expired or missing `agy` login stops the runtime through the same login gate as any other runtime.

## ADDED Requirements

### Requirement: An agy turn runs in print mode against a per-agent config directory
The `agy` adapter SHALL run every turn, and every other `agy` invocation it makes for an agent, as `agy --gemini_dir <dir> …`. `<dir>` SHALL be an absolute path inside that agent's home (`<agent home>/.agy`). The same agent SHALL get the same directory on every turn. A turn SHALL use `-p`, `--output-format stream-json` and `--json-schema <the run's output schema>` whenever the run has one. It SHALL never pass a flag that `agy` 1.5.14 does not accept. It SHALL never read or write the machine owner's default `~/.gemini` directory.

#### Scenario: First turn of a worker
- **WHEN** a worker whose home is `/w/01ABC` starts its first `agy` turn
- **THEN** the command line begins `agy --gemini_dir /w/01ABC/.agy -p --output-format stream-json` and carries no `--conversation`

#### Scenario: The owner's config is never consulted
- **WHEN** the owner's `~/.gemini/config/mcp_config.json` lists a server `blender`
- **THEN** no `agy` invocation the adapter builds can load `blender`, because every invocation names the agent's own `--gemini_dir`

### Requirement: The worker's MCP surface is exactly the run's MCP servers
Before each turn the adapter SHALL write `<dir>/config/mcp_config.json` with an `mcpServers` map that holds exactly the run's MCP servers. It SHALL replace whatever the file held before, so a server from an earlier turn or added by hand does not survive. A stdio server SHALL be written with `command`, `args` and `env`. An HTTP server SHALL be written with `url` and `headers`.

#### Scenario: Weave server only
- **WHEN** a turn's MCP servers are `{ "weave-ai": <http server> }` and the file previously also listed `blender`
- **THEN** after the adapter writes the file, its `mcpServers` keys are exactly `["weave-ai"]`

### Requirement: The runtime refuses to run if config isolation no longer works
`detect()` SHALL check that `--gemini_dir` still isolates MCP configuration on the installed `agy`. It SHALL seed a scratch directory with one server, run `agy --gemini_dir <scratch> mcp list`, and require that exactly that server is listed. This check needs neither a login nor the network. If the check fails, the runtime SHALL be reported as unavailable with a reason that names the failed isolation check, and no turn SHALL be started on it.

#### Scenario: A future agy drops the flag
- **WHEN** `agy --gemini_dir <scratch> mcp list` exits non-zero or lists a server that was not seeded
- **THEN** `detect()` reports `agy` unavailable with a reason naming the isolation check, and the dispatcher starts no `agy` turn

### Requirement: A model is a family plus an effort, sent as one variant id
The adapter SHALL list `agy` models as families with the names captain uses: Gemini 4 Neon, Gemini 4 Argon, Gemini 4 Hydrogen, Orchestrator (Neon), Orchestrator (Argon) and Gemini 3.8 Flash. Each family SHALL carry the efforts `agy models` offers for it. For a family with efforts, the adapter SHALL compose the exact variant id (`<family>-<effort>`) and pass it as `--model`. The effort SHALL be the requested one when the family offers it. Otherwise it SHALL be the highest offered effort not above the requested one, and `medium` when none was requested. The adapter SHALL never pass `--effort`. A model id that is already a full variant id SHALL be passed through unchanged, and any separately requested effort SHALL be ignored. Orchestrator ids SHALL be passed unchanged. Claude and GPT-OSS ids offered through `agy` SHALL NOT be listed.

#### Scenario: Family and effort
- **WHEN** a ticket's worker option is runtime `agy`, model `gemini-4-neon`, effort `high`
- **THEN** the turn passes `--model gemini-4-neon-high` and no `--effort`

#### Scenario: Effort the family does not offer
- **WHEN** the model is `gemini-4-argon` and the effort is `xhigh`
- **THEN** the turn passes `--model gemini-4-argon-high`

#### Scenario: A full variant id with a conflicting effort
- **WHEN** the model is `gemini-4-neon-high` and the effort is `low`
- **THEN** the turn passes `--model gemini-4-neon-high` and no `--effort`

### Requirement: Sessions resume by conversation id
The adapter SHALL take the `conversation_id` reported by the turn's stream as the agent's session ref. On a later turn with a stored ref it SHALL pass `--conversation <id>` with the same `--gemini_dir`. A run whose stream reports no conversation id SHALL keep the previous ref.

#### Scenario: Second turn resumes
- **WHEN** a worker's first turn reported `conversation_id` `c-123`
- **THEN** its second turn passes `--conversation c-123` and the same `--gemini_dir`

### Requirement: The structured report comes from the stream's result
The adapter SHALL take the turn's report from the `structured_output` of the final `result` event when present. Otherwise it SHALL take it from a fenced JSON block in the final response text, as other runtimes do.

#### Scenario: Schema-enforced report
- **WHEN** the final `result` event carries `structured_output` that validates against the run's schema
- **THEN** the turn result's `structured` is that object

### Requirement: An agy login failure is an authentication failure, detected without waiting
The adapter SHALL treat each of the following as an `auth`-family error:
- a stderr line beginning `Authentication required.`
- a `result` event whose `error` is `authentication failed or timed out`
- an `Authentication expired` message

On the stderr prompt the adapter SHALL end the turn immediately rather than let the CLI wait for a pasted code. The error message SHALL be a fixed text naming `agy` and its login command, and SHALL NOT contain the OAuth URL. The existing runtime login gate SHALL then apply to `agy` exactly as it does to `claude`: agents paused with their wakes kept, one decision card, one channel announcement, one incident, and recovery by a successful turn or the operator's re-check.

#### Scenario: Missing login
- **WHEN** `agy` writes `Authentication required. Please visit the URL to log in:` followed by an OAuth URL to stderr
- **THEN** the adapter terminates the process within one second, and the turn fails with family `auth` and a message that contains no URL

#### Scenario: Same outcome as a Claude auth failure
- **WHEN** `agy` turns keep failing with family `auth` until the engine's threshold for gating
- **THEN** the `agy` runtime is gated, a single card titled `The agy login expired — log in again to resume` is raised, and its fix names `weave runtime login agy`

### Requirement: An isolated daemon cannot reach the owner's agy login
On an isolated daemon (VS-143), the engine SHALL start `agy` turns, and every other `agy` invocation, with `DBUS_SESSION_BUS_ADDRESS` removed from the environment and `XDG_RUNTIME_DIR` pointed at an empty private directory. That way no session bus can be found by either route. `agy` then uses its file-based token storage instead of the host user's OS keyring. On a daemon that shares host credentials, the environment SHALL be left as it is.

#### Scenario: Scratch daemon
- **WHEN** an isolated daemon runs an `agy` turn on a host where the owner is logged in to `agy`
- **THEN** the child environment has no `DBUS_SESSION_BUS_ADDRESS`, its `XDG_RUNTIME_DIR` holds no `bus` socket, and the turn fails with family `auth` instead of using the owner's login
