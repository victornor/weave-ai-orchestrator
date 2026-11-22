## Purpose

Run Weave AI agents on Google's Antigravity CLI (`agy`) in print mode, with every model its Antigravity subscription offers (Gemini 4, Claude, GPT-OSS) selectable per ticket. A worker on `agy` sees the weave MCP server and none of the machine owner's own MCP servers, plugins, hooks or global rules. Its sessions resume across turns, its final report validates against the run's schema, and an expired or missing `agy` login stops the runtime through the same login gate as any other runtime. Its runs are never mistaken for the native `claude` runtime's, even on a Claude model.

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
`detect()` SHALL check that `--gemini_dir` still isolates MCP configuration on the installed `agy`. It SHALL seed a scratch directory with one server, run `agy --gemini_dir <scratch> mcp list`, and require that exactly that server is listed. This check needs neither a login nor the network. If the check fails, `detect()` SHALL report the runtime as `unsupported` with a reason that names the failed isolation check. `runTurn` SHALL run the same check once per process for each binary (path and modification time) before its first turn. If the check fails, `runTurn` SHALL fail with a `tooling`-family error and start no turn.

#### Scenario: A future agy drops the flag
- **WHEN** `agy --gemini_dir <scratch> mcp list` exits non-zero or lists a server that was not seeded
- **THEN** `detect()` reports `agy` `unsupported` with a reason naming the isolation check, and every `agy` turn fails with a `tooling` error before any prompt is sent

### Requirement: Every model agy lists is selectable, sent as one variant id
The adapter SHALL list every model `agy models` offers, as families that each carry the efforts offered for them. For 1.5.14 that is 23 ids in nine families:

| Family | Efforts |
|---|---|
| Gemini 4 Neon | low–xhigh |
| Gemini 4 Argon | low–high |
| Gemini 4 Hydrogen | low–xhigh |
| Gemini 3.8 Flash | low–high |
| Orchestrator (Neon) | none |
| Orchestrator (Argon) | none |
| Claude Opus 5.5 (Antigravity) | low–high |
| Claude Sonnet 5.5 (Antigravity) | low–high |
| GPT-OSS 120B | medium |

For a family with efforts, the adapter SHALL compose the exact variant id (`<family>-<effort>`) and pass it as `--model`. The effort SHALL be chosen as follows:
- the requested effort, when the family offers it;
- otherwise the highest offered effort not above the requested one;
- otherwise the lowest offered effort;
- when no effort was requested, `medium` if offered, otherwise the lowest offered.

The adapter SHALL never pass `--effort`. A model id that is already a full variant id, an Orchestrator id, or an id the adapter does not know SHALL be passed through unchanged, and any separately requested effort SHALL be ignored.

#### Scenario: Gemini family and effort
- **WHEN** a ticket's worker option is runtime `agy`, model `gemini-4-neon`, effort `high`
- **THEN** the turn passes `--model gemini-4-neon-high` and no `--effort`

#### Scenario: Claude through agy
- **WHEN** the worker option is runtime `agy`, model `claude-opus-5-5`, effort `high`
- **THEN** the turn passes `--model claude-opus-5-5-high` and no `--effort`

#### Scenario: Effort the family does not offer
- **WHEN** the model is `gemini-4-argon` and the effort is `xhigh`, or the model is `gpt-oss-120b` and the effort is `low`
- **THEN** the turn passes `--model gemini-4-argon-high`, respectively `--model gpt-oss-120b-medium`

#### Scenario: A full variant id with a conflicting effort
- **WHEN** the model is `gemini-4-neon-high` and the effort is `low`
- **THEN** the turn passes `--model gemini-4-neon-high` and no `--effort`

#### Scenario: A model newer than the adapter's list
- **WHEN** the model is an id the adapter does not list
- **THEN** it is passed to `--model` unchanged, and an id `agy` cannot resolve fails the turn with `agy`'s own error

### Requirement: An agy run is never conflated with the native claude runtime
Every `agy` turn result SHALL report provider `antigravity`, whatever model family it ran. Its usage SHALL be recorded under runtime `agy`. A run, its usage events and the per-model usage breakdown (grouped by model and provider) SHALL therefore never merge an `agy`-routed Claude model with the `claude` runtime's own. The `agy` adapter SHALL declare `estimateCostByModel: false`. For such a runtime the engine SHALL NOT estimate a cost from the model id; a run with usage but no reported cost SHALL be `unpriced`, not priced at the model vendor's API rates. Runtimes that do not declare the capability SHALL keep today's estimation.

#### Scenario: Claude Opus through agy
- **WHEN** an `agy` run on `claude-opus-5-5-high` reports usage and no cost
- **THEN** its usage event has runtime `agy`, provider `antigravity` and cost status `unpriced`, and the per-model breakdown shows it on a row separate from any `claude`-runtime row

#### Scenario: Native claude unchanged
- **WHEN** a `claude` runtime run reports usage
- **THEN** its provider, cost and cost status are exactly as before this change

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
