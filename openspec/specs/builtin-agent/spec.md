# builtin-agent Specification

## Purpose
Weave AI's own agent client, so a turn can run on any OpenAI-compatible Chat Completions endpoint without a third-party coding CLI. Slice 1 is the walking skeleton: one real streamed turn with `weave_*` tools over the run-scoped MCP server, cancel, and resume.

## Requirements

### Requirement: A turn runs in a per-run child process speaking protocol v1
The `weave` runtime adapter SHALL run each turn by spawning `@weave-ai/agent`'s entry as a child process in its own process group, under the run's containment. The adapter SHALL send one `init` line on the child's stdin carrying the run, provider (including the API key), prompt, system prompt, session, MCP servers and tool environment, and SHALL read newline-delimited JSON from the child's stdout: `event`, `partial`, `log` and exactly one `result`. The child SHALL write nothing else to stdout. When the child exits without a `result`, the adapter SHALL synthesise an error result from the exit code and signal.

#### Scenario: Normal turn
- **WHEN** the child emits events, partials and a final `result`
- **THEN** the adapter forwards events and partials to the sink and resolves `runTurn` with that result

#### Scenario: Child dies early
- **WHEN** the child is killed by SIGKILL before emitting a result
- **THEN** `runTurn` resolves with an error result of family `resource` and exit code 137

### Requirement: The child's pid is the recorded pid
The adapter SHALL call `onSpawn` with the child's real pid and process group id, and `TurnHandle.pid` SHALL be that pid. Tool subprocesses SHALL join the child's process group, so a group kill by `bootRecovery` or `cancel('kill')` ends them.

#### Scenario: Group kill
- **WHEN** the recorded process group is killed while a `bash` tool subprocess runs
- **THEN** both the child and the tool subprocess are gone

### Requirement: The provider key never reaches argv or any environment
The API key — however it was resolved, from the run environment or from the workspace secret store — SHALL travel only in the `init` line on stdin. It SHALL NOT appear in the child's argv or environment, and SHALL NOT be present in the environment of the `bash` tool or in any log line, event or session file.

#### Scenario: Spawn inspection
- **WHEN** the adapter spawns the child for a provider with a key
- **THEN** neither the argv nor the env passed to the spawn contains the key, and a `bash` tool call that prints its environment does not show it

### Requirement: SSE parsing is byte-exact and split-invariant
The SSE parser SHALL decode a byte stream with a streaming UTF-8 decoder, accept CRLF, LF and CR line endings, `data:` with or without a following space, multi-line `data`, and comment lines, and SHALL deliver the same events however the bytes are split across reads.

#### Scenario: Every split point
- **WHEN** each recorded fixture stream is split at every byte boundary
- **THEN** the assembled assistant message is identical to the unsplit result

### Requirement: The chat-completions codec tolerates real provider stream shapes
The codec SHALL assemble tool calls keyed by `index`, opening a new call when a different non-empty `id` arrives at an index already holding one; SHALL take the name once and ignore a repeat of the same value; SHALL concatenate argument fragments, stringify an object-typed `arguments`, and treat an empty argument string as `{}`; SHALL decide that tools ran from the assembled calls and never from `finish_reason`; SHALL accept `finish_reason` repeated on two chunks; SHALL read reasoning from `reasoning_content`, `reasoning` or `reasoning_details`; SHALL read usage from the `finish_reason` chunk or from a separate chunk with empty `choices`, whether or not `stream_options` was sent; SHALL treat a top-level `error` object in a 200 stream as a failed step; and SHALL record the model the provider reports rather than the one requested.

#### Scenario: Id repeated on every chunk
- **WHEN** every later tool-call chunk repeats the same `id` with a null name
- **THEN** one tool call results, with the concatenated arguments

#### Scenario: Whole arguments in one delta
- **WHEN** a provider sends the entire argument JSON in a single chunk
- **THEN** the call is assembled with those arguments

#### Scenario: Usage on a separate empty-choices chunk
- **WHEN** usage arrives on a chunk whose `choices` is empty after the `finish_reason` chunk
- **THEN** the step's usage is that chunk's usage

#### Scenario: Model substitution
- **WHEN** the response reports a different model id than requested
- **THEN** the turn result records the reported model

### Requirement: Only parameters the user set are sent
The request body SHALL contain `temperature`, `top_p`, the output-token cap and a context-window hint only when the corresponding option (`temperature`, `topP`, `maxOutputTokens`, `contextWindowTokens`) was set. The output-token cap SHALL be sent as `max_tokens`. Option keys other than these four SHALL be rejected by the adapter's `configSchema`.

#### Scenario: Nothing configured
- **WHEN** no option is set
- **THEN** the recorded request body has none of those parameters

### Requirement: The turn streams partials and normalized events
The child SHALL emit a `text` partial with `partId = <messageId>:t` for each content delta, a `thinking` partial for reasoning deltas, and a `tool_input` partial with `toolCallId` for argument fragments, coalesced to at most one message per 25 ms per part. It SHALL emit `assistant.text` and `assistant.thinking` events carrying the same `partId`, `tool.call` as soon as a call's arguments finish parsing and before execution begins, `tool.result` after it, `usage.delta` when each request ends, and `turn.completed`. `RUNTIME_PARTIAL_OUTPUT` SHALL declare `weave: 'full'`, matching the adapter's `capabilities.partialOutput`.

#### Scenario: Tool turn
- **WHEN** the model answers a prompt with one `read` call and then a final text
- **THEN** the events arrive in the order `tool.call`, `tool.result`, `assistant.text`, `usage.delta`, `turn.completed`, and the partials' `partId` matches `assistant.text`

### Requirement: Cancel is honoured at every await and leaves a valid session
A cancel SHALL abort the in-flight request, stream read, tool execution and MCP call. On cancel with tool calls outstanding the child SHALL append a synthetic result `[Tool execution was interrupted]` for each, persist the assistant content seen so far, and exit with code 143 and signal `SIGTERM`. A session file after any cancel SHALL load and SHALL be a valid message history.

#### Scenario: Cancel during a bash tool
- **WHEN** cancel arrives while a `bash` call runs
- **THEN** the subprocess group is killed, the session ends with a synthetic tool result for that call, and the exit code is 143

#### Scenario: Cancel while streaming
- **WHEN** cancel arrives mid-stream
- **THEN** the request is aborted, the text received so far is persisted, and the exit code is 143

### Requirement: Sessions persist as linear JSONL and resume
The child SHALL append one complete JSON line per entry to `<configHome>/weave-agent/sessions/<sessionId>.jsonl` (a header line, then messages in the agent's own content-block form), flushing each line. Loading SHALL discard a torn final line. A later turn SHALL load the session and send the prior messages in its request. The adapter SHALL return a `SessionRef` of `{v:1, id, path, leafId}`. Files SHALL not be deleted in this slice.

#### Scenario: Second turn sees the first
- **WHEN** a second turn runs with the first turn's session ref
- **THEN** the recorded request body contains the first turn's user and assistant messages before the new prompt

#### Scenario: Torn last line
- **WHEN** the session file ends in a partial JSON line
- **THEN** it loads with every complete entry and the partial line ignored

### Requirement: `read` and `bash` enforce their caps
`read` SHALL return `<n>\t<line>` rows capped at 2000 lines, 50 KB and 2000 characters per line, with a footer naming the range and the offset to continue, list a directory (sorted, `/` suffix, at most 500 entries), and refuse a binary file. `bash` SHALL run one fresh shell in the worktree with the turn's tool environment, merge stdout and stderr, tail-truncate to 30 000 characters or 2000 lines with the full output spilled to `<runDir>/tool-output/<callId>.txt` outside the worktree and named in the footer, append `exit code: N`, and on timeout kill the process group and return `[timed out after Ns]`. A tool error SHALL be an ordinary result beginning `Error:`.

#### Scenario: Large read
- **WHEN** `read` targets a 5000-line file without a range
- **THEN** it returns lines 1–2000 and a footer `[showing lines 1-2000 of 5000; call read with offset=2001]`

#### Scenario: Large bash output
- **WHEN** a command prints more than 30 000 characters
- **THEN** the result is the tail, its footer names the spill file, and the spill file holds the full output

### Requirement: `weave_*` tools reach the run-scoped MCP server
The child SHALL connect to each server in `mcpServers` over streamable HTTP (JSON and SSE responses, `Mcp-Session-Id`), list its tools at start with a 30 s timeout, expose them to the model under their own names, and call them with the configured headers, so the run token appears only in the MCP client's request header. A failure to list the Weave server SHALL end the turn with error family `tooling` and code `mcp_unavailable`.

#### Scenario: Tool call over MCP
- **WHEN** the model calls `weave_ticket_get`
- **THEN** the child sends a `tools/call` to the run-scoped server with the run's bearer header and returns its text as the tool result

### Requirement: A turn reports usage
The result SHALL sum token usage over the turn's requests, set `contextTokens` to the last request's prompt tokens, and split the first request into fresh and cached tokens when the provider reports cached tokens. When a provider reports no usage the child SHALL estimate it. No cost SHALL be reported in this slice.

#### Scenario: Two-request turn
- **WHEN** a turn makes a tool request then a final request
- **THEN** `usage.inputTokens` is the sum and `usage.contextTokens` is the second request's prompt tokens

### Requirement: Adapter surface for this slice

The `weave` adapter SHALL declare `resumableSessions: true`, `streamingInput: true`, `structuredOutput: true`, `mcp: true`, `usageReporting: 'per_turn'`, `costReporting: false` and `partialOutput: 'full'`. `TurnHandle.send` SHALL be present and SHALL resolve `delivered` while the turn runs and `closed` once the child's result has been seen. The adapter SHALL forward the child's `structured` result. Model ids SHALL be `providerId/modelId` from workspace `providers` config. `detect()` SHALL be `available` only when the child entry exists and a provider is configured.

#### Scenario: No provider configured

- **WHEN** the workspace has no `providers` entry
- **THEN** `detect()` reports `unsupported` with a note

#### Scenario: Send while running and after the result

- **WHEN** a turn is running and `send` is called, then called again after the turn's result
- **THEN** the first call resolves `delivered` and the second resolves `closed`

### Requirement: Parameters resolve by precedence and unset ones are never sent
The agent SHALL resolve request flags and parameters from the layers preset, provider profile, model entry, then the role or worker option, a higher layer replacing a lower one field by field. A parameter no layer sets SHALL NOT appear in the request body, and any name in `omitParams` SHALL NOT appear even when `extraBody` supplies it.

#### Scenario: Precedence
- **WHEN** the preset sets `temperature` 0.2, the model entry sets 0.5 and the worker option sets 0.9
- **THEN** the request carries `temperature: 0.9`

#### Scenario: Unset and omitted
- **WHEN** no layer sets `topP` and `omitParams` lists `temperature`
- **THEN** the body contains neither `top_p` nor `temperature`

### Requirement: Compat flags shape the request
The codec SHALL honour `maxTokensParam`, `streamUsage`, `systemRole`, `reasoning.effortParam`/`effortMap`, `reasoning.passBack`, `tools.parallel`, `tools.choice`, `tools.strict`, `tools.idFormat`, `strictAlternation`, `emptyContent`, `responseFormat`, `seedParam` and `stopMax`.

#### Scenario: Output cap name
- **WHEN** `maxTokensParam` is `max_tokens` and `maxOutputTokens` is 100
- **THEN** the body has `max_tokens: 100` and no `max_completion_tokens`

#### Scenario: Reasoning pass-back
- **WHEN** a profile sets `reasoning.passBack: reasoning_content`
- **THEN** assistant tool-step messages of the current turn carry `reasoning_content` and earlier turns do not

### Requirement: Providers are data
A provider defined only by a YAML profile (preset, base URL, secret, flags) SHALL run a turn with no code change.

#### Scenario: YAML profile turn
- **WHEN** a profile parsed from YAML points at a mock endpoint
- **THEN** a mock turn completes through it

### Requirement: Option keys are validated
The `weave` adapter's `configSchema` SHALL declare `temperature`, `topP`, `frequencyPenalty`, `presencePenalty`, `maxOutputTokens`, `seed`, `stop`, `toolChoice`, `parallelToolCalls`, `responseFormat`, `extraBody`, `extraHeaders` and `contextWindowTokens`, and `validateRuntimeOptions` SHALL reject out-of-range values.

#### Scenario: Out of range
- **WHEN** `temperature` is 3 or `topP` is -1
- **THEN** validation fails naming the key

### Requirement: Models list themselves
`listModels` SHALL merge the profile's static models with `GET {baseUrl}{modelsPath}` results, cache discovery for 10 minutes per provider, and return the static list when discovery fails.

#### Scenario: Discovery 500
- **WHEN** the endpoint answers 500
- **THEN** `listModels` returns the static models and does not throw

### Requirement: Concurrency and quota mapping
The adapter SHALL hold at most `maxConcurrentRuns` concurrent child runs per provider. An HTTP 402 SHALL map to family `provider_quota`, and a gateway 5xx body saying routes failed after N attempts SHALL NOT be retried beyond a single retry.

#### Scenario: 402
- **WHEN** the endpoint answers 402
- **THEN** the turn ends with `provider_quota`

### Requirement: Providers can be tested on demand
`POST /providers/:id/test` SHALL run the conformance probes against the named provider using its secret and return a per-capability verdict; it SHALL run only when requested.

#### Scenario: Test route
- **WHEN** a client posts to the route for a configured provider with a mock endpoint
- **THEN** the response lists each probe with ok/detail

### Requirement: `write` creates or overwrites a file atomically

The `write` tool SHALL accept `path` and `content`, write through a temporary file in the destination directory, flush it, rename it into place and preserve an existing file's mode, unlinking the temporary file if any step fails. It SHALL answer `Created <path> (N bytes)` for a new file and `Overwrote <path> (N bytes)` for an existing one, and SHALL emit a `file.changed` event carrying the path, the change type (`created` or `modified`) and the added and removed line counts. A file larger than 10 MB SHALL be refused with a message telling the model to use `bash`. Overwriting an existing file SHALL require a prior `read` of that path in the same turn.

#### Scenario: New file
- **WHEN** `write` targets a path that does not exist
- **THEN** the file exists with the given bytes and the result is `Created <path> (N bytes)`

#### Scenario: Atomic failure
- **WHEN** the rename step fails after the temporary file was written
- **THEN** the destination is unchanged and the temporary file is gone

#### Scenario: Refused without a prior read
- **WHEN** `write` overwrites a path the turn has not read
- **THEN** the result is an error naming the missing read and no bytes are written

### Requirement: `edit` replaces text through an ordered match chain with ambiguity as an error

The `edit` tool SHALL accept `path`, `old_string`, `new_string` and an optional `replace_all`, and SHALL find `old_string` by trying, in order: an exact match; a line-trimmed match; a whitespace-normalised match; an indentation-flexible match; and a smart-quote-normalised match. It SHALL apply a stage only when that stage yields exactly one match; more than one match without `replace_all` SHALL be an error naming the match count and telling the model to add context or set `replace_all`, and the tool SHALL NOT fall through to a fuzzier stage in that case. No match at any stage SHALL be an error saying the string was not found. `old_string` equal to `new_string` SHALL be an error. On success the tool SHALL answer `Edited <path>: N replacement(s)` followed by a unified diff hunk with three lines of context, SHALL emit a `file.changed` event carrying the path, change type `modified`, the added and removed counts and that diff, and SHALL refresh the read ledger so a following `edit` needs no re-read. CRLF line endings and a byte-order mark SHALL be detected and preserved across the edit.

#### Scenario: Ambiguous match
- **WHEN** `old_string` occurs three times without `replace_all`
- **THEN** the result is an error naming three matches and the file is unchanged

#### Scenario: CRLF and BOM preserved
- **WHEN** `edit` changes one line of a file whose lines end `\r\n` and that starts with a byte-order mark
- **THEN** the written file still starts with the byte-order mark and still uses `\r\n`

### Requirement: A read ledger detects a file that changed since it was read

The turn SHALL keep a ledger of every successful `read`, recording the resolved path, modification time, size and content hash. Before applying a `write` to an existing file or any `edit`, the tool SHALL stat and hash the file and SHALL refuse with `Error: file changed since it was read; read it again` when either differs from the ledger. A successful `write` or `edit` SHALL update the ledger entry to the new state. The ledger SHALL be per turn.

#### Scenario: Stale file
- **WHEN** a file is read, changed outside the tool, and then edited
- **THEN** the edit is refused with the stale-file error and the file is left alone

### Requirement: File tools are confined to the worktree and the agent home

A `path` SHALL be resolved against the worktree, then resolved through `realpath` so that a symlink is checked by its target, and then tested against the allowed roots: the worktree and the agent home. The check SHALL treat the worktree and the home as the only writable roots. Refused in every mode, including `bypass`, SHALL be: the worktree's `.git` internals (`hooks`, `config`), the agent home's daemon-rendered discovery files (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `.opencode/`), and the workspace state directory reachable from the child's runtime configuration home (the directory holding `secrets.enc`, `secrets.key`, the daemon database and the runtime homes). Reads outside the roots SHALL be allowed only in `auto` and `bypass`, and only for system paths (`/usr`, `/etc/os-release`-class) and the run's tool-output spill directory; `restricted` SHALL allow no read outside the roots. A refusal SHALL be an ordinary error result beginning `Error:`.

#### Scenario: Symlink escape
- **WHEN** a file inside the worktree is a symlink whose target is outside every root
- **THEN** writing through the symlink path is refused

#### Scenario: Parent traversal
- **WHEN** `path` is `../../` relative to the worktree and resolves outside the roots
- **THEN** the tool refuses it

#### Scenario: Protected discovery file
- **WHEN** `write` targets the home's `AGENTS.md` in `bypass`
- **THEN** it is refused

#### Scenario: System read in restricted
- **WHEN** `read` targets `/usr/share/…` in `restricted`
- **THEN** it is refused, while the same read in `auto` is allowed

### Requirement: `grep` searches with `rg` when present and a built-in fallback otherwise

The `grep` tool SHALL accept `pattern`, and optional `path`, `glob`, `ignore_case`, `output_mode` (`content`, `files_with_matches`, `count`), `context` and `head_limit`. It SHALL use `rg` when it is on `PATH`, respecting ignore files and never searching `.git`, and SHALL otherwise walk the tree itself with a small `.gitignore` reader and JavaScript `RegExp`. `content` output SHALL be `path:line:text` rows, `files_with_matches` SHALL be one path per line in modification-time order, and `count` SHALL be `path:N`; output SHALL be capped at `head_limit` and carry a truncation note when it was applied. The child SHALL log once which implementation it is using.

#### Scenario: Both implementations agree
- **WHEN** the same pattern and directory are searched with `rg` available and with it hidden from `PATH`
- **THEN** both produce the same matching rows

### Requirement: `glob` lists matching paths by recency

The `glob` tool SHALL accept `pattern` and an optional `path`, SHALL return up to 100 matching paths ordered by modification time descending, and SHALL append a truncation note when more matched than were shown.

#### Scenario: More than the cap
- **WHEN** a pattern matches more than 100 files
- **THEN** the newest 100 are returned with a note that more matched

### Requirement: The three permission modes decide the tool set up front

`restricted` SHALL expose only `read`, `grep`, `glob`, `todo_write`, `skill`, the run-scoped Weave server's tools, and the tools of a user MCP server whose definition sets `readOnly: true` and that the role's allow list names; it SHALL remove the write-capable tools (`write`, `edit`, `bash`) and every other user MCP server's tools from the request body itself so the model is never offered them. `auto` SHALL expose all seven core tools (`read`, `write`, `edit`, `bash`, `grep`, `glob`, `todo_write`) plus every allowed MCP server's tools, enforce the confinement rules and the bash deny patterns, and never ask for approval. `bypass` SHALL expose all tools, skip the bash deny patterns and skip root confinement for reads, while the protected-path list still applies to the file tools. A synthetic internal tool the loop adds itself (`submit_result`) SHALL be offered in every mode. A call the mode does not allow SHALL return `Denied by permission mode "<mode>"` and SHALL emit a `tool.denied` event rather than an unknown-tool error.

#### Scenario: Restricted request body

- **WHEN** a turn runs in `restricted` with the run-scoped Weave server and a user MCP server available
- **THEN** the recorded request body's tool list contains only `read`, `grep`, `glob`, `todo_write`, `skill` and the run-scoped Weave tools, and no user `mcp__…` tool

#### Scenario: A read-only user server survives restricted

- **WHEN** a turn runs in `restricted`, the role allows a server marked `readOnly: true`, and the server lists its tools
- **THEN** that server's `mcp__…` tools are in the request body's tool list

#### Scenario: Forced call in restricted

- **WHEN** the model calls `write` in a `restricted` turn
- **THEN** the result is `Denied by permission mode "restricted"` and a `tool.denied` event is emitted

### Requirement: `auto` refuses known-dangerous shell commands

In `auto`, `bash` SHALL refuse a command matching the deny patterns — `pkill`, `killall`, a `kill` fed by `pgrep`, `systemctl`, `weave|conductor daemon (start|stop|restart|upgrade)`, `sudo`, `gh auth login`, a push to a default branch, and `rm -rf` of `/`, `~` or `$HOME` — before the command runs, returning a refusal that names the rule, and SHALL emit `tool.denied`. The patterns SHALL be extended by a role's configured list. An ordinary command SHALL run as before.

#### Scenario: Denied patterns
- **WHEN** `bash` is called with `pkill -f x`, `systemctl restart y` or `weave daemon stop` in `auto`
- **THEN** each is refused, nothing is executed, and a `tool.denied` event is emitted

#### Scenario: Allowed command
- **WHEN** `bash` is called with `git status` in `auto`
- **THEN** it runs and returns the command's output

### Requirement: Tool allow and deny lists match the Claude aliases

`allowedTools` SHALL be exhaustive on an interactive first turn, and `deniedTools` SHALL always remove. Both SHALL match case-insensitively on the tool's own name and on its Claude alias, so `Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob` and `TodoWrite` select the same tools as their lower-case names.

#### Scenario: Alias in denied list
- **WHEN** `deniedTools` contains `Bash` and the model calls `bash`
- **THEN** the call is denied and `tool.denied` is emitted

#### Scenario: Alias in the allow list
- **WHEN** `allowedTools` contains `Edit` on the first interactive turn and the model calls `edit`
- **THEN** the call is allowed

### Requirement: The file and command events reach the transcript

`write` and `edit` SHALL emit `file.changed`; `bash` SHALL emit `command.executed` carrying the command, the exit code and the output; a permission refusal SHALL emit `tool.denied`. The `weave` adapter SHALL forward all three to the run's event sink unchanged. The run transcript SHALL render an `edit` as a file block with its diff and added/removed counts, and a `bash` call as a tool row whose target is the command.

#### Scenario: Edit renders as a diff
- **WHEN** a transcript is built from a weave `tool.call` for `edit` and its `file.changed` event
- **THEN** the blocks contain a file block whose diff carries the unified hunk and whose diff stat matches the counts

#### Scenario: Bash renders as a command
- **WHEN** a transcript is built from a weave `tool.call` for `bash`, its `tool.result` and its `command.executed` event
- **THEN** one tool row remains, its target is the command, and its status reflects the exit code

### Requirement: Failures are classified by one table into the run error families
The agent SHALL classify every provider failure from HTTP status, body, headers, network error code and in-stream error through one table, and each row SHALL name a code, a run error family, whether it is retried and its retry cap. A 402, and a 429 or 403 whose body names insufficient quota or billing, SHALL be `provider_quota`. 401 and 403 without quota wording SHALL be `auth`. A 5xx or 400 whose message says routes failed after N attempts SHALL be `transient_upstream` with a retry cap of one. An OpenRouter `Provider returned error` SHALL be classified from its `metadata.raw` upstream body. Z.ai numeric-string codes SHALL be read. A top-level `error` inside a 200 stream SHALL be classified the same way. `finish_reason: content_filter` and `message.refusal` SHALL be `model_refusal`.

#### Scenario: Every recorded row
- **WHEN** each fixture in the error table is classified (OpenAI-style 401, unknown model, malformed JSON, DeepSeek 402 and 422, Z.ai 401/1211/1214 and the leaked parse error, OpenRouter wrapped 400 and 401, the gateway 502 and 400 "routes failed", an error object in a 200 stream, a content filter)
- **THEN** each maps to its documented code and family

#### Scenario: Quota
- **WHEN** the provider answers 402 `Insufficient Balance`
- **THEN** the turn fails `quota_exhausted` in family `provider_quota` and is not retried by the agent

#### Scenario: Gateway exhaustion is capped
- **WHEN** the provider keeps answering 502 "All available provider routes failed after 6 attempts"
- **THEN** the agent retries once, then fails, and does not retry endlessly

### Requirement: The step and output caps are not retried by the engine
A turn stopped by the step cap, the token budget or a twice-truncated output SHALL carry family `tooling`, never `resource`, because the run engine re-queues `resource` failures.

#### Scenario: Step cap
- **WHEN** the loop reaches its step cap
- **THEN** the result error is `max_steps` with family `tooling`

### Requirement: Transient failures retry on a ladder that honours the provider
The agent SHALL retry transient failures with exponential backoff and jitter, SHALL wait at least the `Retry-After` value given as seconds or as an HTTP date, SHALL surface without waiting when that value exceeds two minutes or would pass the run deadline, and SHALL retry a stream that drops before a finish reason. Connect, idle and whole-request timeouts SHALL apply, and SSE comment lines SHALL reset the idle timer.

#### Scenario: Retry-After as a date
- **WHEN** a 429 carries `Retry-After` as an HTTP date 10 seconds ahead
- **THEN** the next attempt starts no earlier than 10 seconds later

#### Scenario: 429 storm
- **WHEN** the provider answers 429 more times than the retry cap
- **THEN** the turn fails `rate_limited` in family `transient_upstream` carrying `retryAfterMs`

#### Scenario: Dropped stream
- **WHEN** the connection closes mid-stream before a finish reason
- **THEN** the step is retried and the completed step is the one recorded

#### Scenario: Stall and keepalive
- **WHEN** the provider sends no bytes for the idle window
- **THEN** the attempt fails as a timeout; and when it sends only comment lines, the idle timer keeps resetting

### Requirement: Malformed tool arguments are repaired or corrected
The agent SHALL repair tool-call arguments that are torn, fenced, or have trailing commas, and SHALL otherwise answer the call with a corrective result through an `invalid` path without executing anything. Three consecutive invalid calls SHALL fail the turn `tool_call_invalid`.

#### Scenario: Torn JSON
- **WHEN** a call's arguments are `{"path":"a.txt"`
- **THEN** the call runs with `path` `a.txt`

#### Scenario: Unrepairable
- **WHEN** a call's arguments cannot be repaired
- **THEN** the model receives a corrective result naming the tool and the parse error, and no tool runs

### Requirement: A repeating tool call is stopped
The agent SHALL refuse a fourth identical tool call (same name and arguments, same results) once with a corrective result and SHALL fail the turn `doom_loop` if it repeats again.

#### Scenario: Doom loop
- **WHEN** the model issues the same call with the same result four times and again after the warning
- **THEN** the turn fails `doom_loop` in family `tooling`

### Requirement: Output truncation is recovered once
When a step ends `finish_reason: length` with text and no tool call, the agent SHALL ask the model to continue once; a second truncation in the turn SHALL fail `output_truncated` in family `tooling`.

#### Scenario: Recovered
- **WHEN** the first step ends `length` and the continuation ends `stop`
- **THEN** the turn completes with both texts in the session

### Requirement: Duplicate indices and missing ids do not break assembly
The tool-call assembler SHALL synthesise an id for a call the provider sent without one, and SHALL keep two parallel calls apart when a provider reuses an index with different ids.

#### Scenario: Missing id
- **WHEN** a tool call arrives with no `id`
- **THEN** it runs under a generated id and its result pairs with it

### Requirement: debugWire capture is opt-in and redacted
With `debugWire` set, the agent SHALL write each request and response to a wire file outside the worktree. No provider key, authorization header or tool environment value SHALL appear in it. Without the option nothing SHALL be written.

#### Scenario: No secret
- **WHEN** a turn runs with `debugWire` and a provider key
- **THEN** the wire file exists and contains neither the key nor any authorization header value

### Requirement: A workspace's model providers can be read with their secret state

The daemon SHALL expose this workspace's configured `weave` providers over `GET /providers`: for each
one its id, its profile as configured (base URL, preset, auth, headers, query, discovery, concurrency,
timeouts, `compat`, `params`, and the model ids it lists) and whether the secret its `apiKeySecret`
names currently holds a value. It SHALL also return the built-in preset catalogue the daemon ships —
each preset's id, its description and a suggested base URL — so a client can add a provider from one.
The response SHALL NOT contain a secret value, and no route SHALL return one.

#### Scenario: Listing configured providers

- **WHEN** a client requests the workspace's providers
- **THEN** each configured provider appears with its profile fields, the ids of its models, and a
  boolean saying whether its key is set, and no entry carries a key value

#### Scenario: One provider is unconfigured

- **WHEN** a configured provider names an `apiKeySecret` with no value in the workspace
- **THEN** its secret state reads as not set and the rest of the profile is still returned

#### Scenario: An empty workspace

- **WHEN** the workspace config has no `providers`
- **THEN** the list is empty and the preset catalogue is still returned

### Requirement: A provider profile can be created, updated and removed

The daemon SHALL accept `PUT /providers/:id` to create or replace the provider profile named in the
path, validating it against the provider schema and refusing an invalid one with the schema's issues,
and `DELETE /providers/:id` to remove it. Creating, updating and removing a profile SHALL write the
workspace config and take effect for turns started after it. An id whose path names one provider
SHALL NOT be able to create a different one.

#### Scenario: Create and update

- **WHEN** a client puts a valid profile for an id that has none
- **THEN** the provider appears in the list and a later put of the same id replaces its profile

#### Scenario: An invalid profile

- **WHEN** a client puts a profile with an invalid base URL or a malformed compat flag
- **THEN** the write is refused with the schema's issues and the stored profile is unchanged

#### Scenario: Remove

- **WHEN** a client deletes a configured provider
- **THEN** it no longer appears in the list or in a new turn's provider resolution

### Requirement: A provider's key is set and cleared, and never read back

The daemon SHALL accept a provider's API key through its own route, registering it in the workspace
secret store under the profile's `apiKeySecret`, and SHALL clear it on request. Setting a key for a
provider whose `apiKeySecret` is unset SHALL be refused. The key's value SHALL never appear in any
response, log line, event, error or config file; only whether a value is held SHALL be readable.

#### Scenario: Setting and replacing a key

- **WHEN** a client submits a key for a configured provider
- **THEN** the workspace's secret store holds it under the profile's `apiKeySecret`, the secret state
  reads as set, and the response carries no value

#### Scenario: Clearing a key

- **WHEN** a client clears a provider's key
- **THEN** the secret state reads as not set and a test connection reports the missing key

#### Scenario: The key is never in an error

- **WHEN** a key is rejected by validation or a probe fails
- **THEN** the response names the secret and the reason, and nowhere contains the value

### Requirement: The provider key comes from the run's own workspace when no role carries it
The `weave` adapter SHALL resolve a provider's API key from the run environment first, so a role that carries the secret still wins and the daemon host's own environment keeps its precedence, and otherwise from the secret store of the run's own workspace through `RuntimeHost.providerKey(providerId, workspaceId)`. A run with no role SHALL therefore be able to use a key saved under Settings > Providers. When the provider requires a key and neither source holds one, the turn SHALL fail `key_missing` (family `auth`) with a message naming Settings > Providers and a role secret as the places it can be set.

#### Scenario: A run with no role uses the workspace key
- **WHEN** a run has no role, the provider requires a key, and the run's workspace secret store holds the value named by the provider's `apiKeySecret`
- **THEN** the turn resolves that key and completes

#### Scenario: A role secret still wins over the store
- **WHEN** the role carries the provider secret's environment variable and the workspace store also holds a value
- **THEN** the value from the run environment reaches the child

#### Scenario: No key anywhere
- **WHEN** neither the run environment nor the run workspace's store holds the provider key
- **THEN** the turn fails `key_missing` and the message names Settings > Providers and a role secret

### Requirement: Provider lookup is scoped to the run's own workspace
`RuntimeHost.providers()` and `RuntimeHost.providerKey()` SHALL accept an optional workspace id. A turn SHALL carry the id of the workspace it belongs to, and the `weave` adapter SHALL resolve both the provider profile and its API key from that workspace — for the turn and for discovery of that runtime's models — so a second workspace that defines the same provider id never uses another workspace's profile or key. A workspace that does not define the provider id SHALL fail `provider_not_configured` rather than fall back to another workspace's definition. A caller with no workspace, such as the daemon's runtime catalog, SHALL keep the current aggregate behaviour.

#### Scenario: Two workspaces, one provider id
- **WHEN** two workspaces each define the same provider id with a different key, and a run belongs to the second
- **THEN** the child receives the second workspace's key

#### Scenario: Model discovery of a workspace's provider
- **WHEN** the models of the runtime are listed for one workspace
- **THEN** the provider profile and key used are that workspace's

### Requirement: A store-resolved provider key is redacted from the run
The provider key resolved from the workspace secret store SHALL be added to the run's redaction values, so it never appears in a transcript, event or log, exactly as a role-attached secret value is redacted today.

#### Scenario: A transcript that echoes the key
- **WHEN** a turn's output contains the store-resolved provider key
- **THEN** what the turn records carries a redaction marker and not the key

### Requirement: MCP clients share one interface and a stdio transport exists

The child SHALL speak MCP through one client interface with `initialize`, `listTools`, `callTool` and `close`, implemented by the existing streamable-HTTP client and by a new stdio client. The stdio client SHALL spawn the configured server's `command` and `args` with its `env`, exchange newline-delimited JSON-RPC over its stdio, forward its stderr as child `log` lines, apply a 30 s timeout to `initialize`/`tools/list` and a 60 s timeout to `tools/call`, send `notifications/cancelled` and kill the child on abort, and reap the child when the turn ends or the client closes. A server config SHALL be routed to the stdio client by `type: 'stdio'` and to the HTTP client otherwise.

#### Scenario: A stdio server works against a fake server script
- **WHEN** a fake stdio server script advertises one tool and answers a call with text
- **THEN** `listTools` returns that tool and `callTool` returns its text, and no HTTP request is made

#### Scenario: A stdio server that ignores SIGTERM is reaped
- **WHEN** `close()` is called on a stdio client whose child traps SIGTERM
- **THEN** the child is killed and no longer running after the grace period

#### Scenario: The child init carries a stdio server
- **WHEN** a turn's `mcpServers` contains a `type: 'stdio'` entry with `command` and `args`
- **THEN** the child's `init` line carries that entry's command, args and env, and the HTTP entry shape is unchanged

### Requirement: Non-Weave MCP tools are named with collisions suffixed

A tool from a server other than the run-scoped Weave server SHALL be exposed as `mcp__<server>__<tool>`, with each segment reduced to `[A-Za-z0-9_-]` and the whole name kept within 64 characters. The run-scoped Weave server's tools SHALL keep their own names, unprefixed. Names SHALL be assigned from one namespace across all servers, so a collision with a Weave tool name or with another server's tool is given a suffix (`_2`, `_3`, …) rather than overwriting it, and the model's wire name SHALL map back to the original `(server, tool)` for the call.

#### Scenario: Two servers produce the same wire name
- **WHEN** two different servers yield the same sanitised `mcp__a__b` name
- **THEN** one keeps `mcp__a__b` and the other is exposed with a numeric suffix, and each call reaches its own server

#### Scenario: Weave tools stay unprefixed
- **WHEN** the Weave server and another server both load
- **THEN** the Weave server's tools are offered under their own names (e.g. `weave_ticket_get`) and the other server's tools are prefixed

#### Scenario: A long or unsanitised name
- **WHEN** a server or tool name contains characters outside `[A-Za-z0-9_-]` or the assembled name exceeds 64 characters
- **THEN** the exposed name is sanitised and truncated to 64 characters and still maps to its server and tool

### Requirement: MCP results are capped and their image parts are lifted

A tool result's text parts SHALL be concatenated and, when the combined text exceeds 50 KB, truncated to 50 KB with a marker stating the cap. An image content part SHALL be returned as an image part and lifted into the request like an image read from a file; a part that is neither text nor image SHALL be recorded as omitted.

#### Scenario: Result over the cap
- **WHEN** an MCP tool returns more than 50 KB of text
- **THEN** the result is the first 50 KB followed by a marker naming the cap

#### Scenario: Image part in a result
- **WHEN** an MCP tool returns an image content part
- **THEN** the turn carries it as an image part in the request rather than as text

### Requirement: `web_fetch` fetches public http(s) and returns text

The `web_fetch` tool SHALL accept `url` and an optional `max_bytes`, allow only `http` and `https`, follow at most 5 redirects, read at most 5 MB, time out after 30 s, and return a status line followed by the body reduced to text (HTML reduced by stripping tags and decoding entities, other textual media types returned as they are), capped at 50 KB with a marker. A binary media type SHALL be refused. A refusal SHALL be an ordinary error result beginning `Error:`.

#### Scenario: A public page
- **WHEN** `web_fetch` targets a public http(s) URL whose body fits the cap
- **THEN** the result begins with the status line and contains the page's text

#### Scenario: Body over the read cap
- **WHEN** the target sends more than `max_bytes`
- **THEN** the tool returns the text it read and does not read further

### Requirement: `web_fetch` refuses non-public targets, including via redirect and DNS rebinding

`web_fetch` SHALL classify the resolved addresses of the target host and refuse a loopback, private, link-local, CGNAT or cloud-metadata address (IPv4 and IPv6, including IPv4-mapped), and SHALL refuse a host that resolves to an empty answer. It SHALL resolve the host **once** and connect to the address it resolved, so a resolver that answers differently on a second lookup cannot redirect the connection. Every redirect hop SHALL be re-resolved and re-checked under the same rule, and a scheme other than `http`/`https` SHALL be refused. The refusal SHALL name the reason (`loopback`, `private`, `link-local`, `metadata`, `redirect limit`, `unsupported scheme`).

#### Scenario: Direct private target
- **WHEN** `web_fetch` targets `127.0.0.1`, `10.0.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `[::1]` or `[fd00::1]`
- **THEN** each is refused with the range named and no request is sent

#### Scenario: Redirect to a private target
- **WHEN** a public target answers a redirect whose `Location` is a private address
- **THEN** the redirect hop is refused and its body is not fetched

#### Scenario: DNS rebinding
- **WHEN** the resolver answers with a public address for the check and a private address on any later lookup
- **THEN** the connection uses the address that passed the check and the private address is never connected to

#### Scenario: IPv4-mapped IPv6
- **WHEN** the resolver answers with `::ffff:127.0.0.1`
- **THEN** it is refused as loopback

### Requirement: `web_fetch` is denied in `restricted` and off by default

`web_fetch` SHALL be removed from the request's tool list in `restricted` and a call SHALL return `Denied by permission mode "restricted"` with a `tool.denied` event. In `auto` and `bypass` it SHALL be offered only when the turn's `webFetch` option is true; a call while it is disabled SHALL return an error naming the option, and no request SHALL be sent.

#### Scenario: Restricted request body
- **WHEN** a `restricted` turn runs with `webFetch` true
- **THEN** the recorded request body's tool list contains no `web_fetch`

#### Scenario: Disabled by default
- **WHEN** a turn runs in `auto` without the `webFetch` option and the model calls `web_fetch`
- **THEN** the result is an error naming the option and no network request is made

### Requirement: `read` returns an image part under the profile's `image.input` mode

The `read` tool SHALL detect a PNG, JPEG, GIF or WebP by its magic bytes before the binary-file check, and for a supported image up to 5 MB SHALL return an image content part plus a short text result. The request SHALL carry that image according to the provider compat flag `image.input`: `user` (the default) lifts the image into a synthetic user message after the tool result, `user_and_tool` places the image part inside the tool message's content, and `none` returns `Error: this model cannot read images` with no image part. An image over the size cap or of an unsupported type SHALL keep the existing too-large or binary refusal.

#### Scenario: Default lift to a user message
- **WHEN** `read` targets a png under `image.input:user`
- **THEN** the recorded request carries the image as an `image_url` data part in a user message and the tool result as text

#### Scenario: Image inside the tool message
- **WHEN** `read` targets a png under `image.input:user_and_tool`
- **THEN** the recorded request carries the image part inside the `tool` message's content and no extra user message

#### Scenario: Images unsupported
- **WHEN** `read` targets a png under `image.input:none`
- **THEN** the result is `Error: this model cannot read images` and the request carries no image

#### Scenario: A JPEG is detected as an image
- **WHEN** `read` targets a file beginning `FF D8 FF` under `image.input:user`
- **THEN** it returns an image part rather than the binary-file error

### Requirement: Sessions are trees with compaction records
The session file SHALL keep one entry per message with `id` and `parentId`, and SHALL support a `compaction` entry carrying a summary, `firstKeptEntryId`, token counts before and after, and accumulated read and modified file lists. The history sent to the model SHALL be the summary as a first user message followed by the messages from `firstKeptEntryId` to the leaf. Files written before this change SHALL load unchanged, and a torn last line SHALL be dropped.

#### Scenario: A compacted session resumes
- **WHEN** a session containing a compaction entry is resumed and the next request is built
- **THEN** the first non-system message of the request body is the summary and the messages before `firstKeptEntryId` are absent

#### Scenario: Old linear file
- **WHEN** a session file with only message entries is loaded
- **THEN** its history is every message in order

### Requirement: Compaction never splits a tool call from its results
The compactor SHALL choose the start of the kept span on a turn boundary, a `user` or `assistant` message and never a tool result, so that every kept tool result has its tool call in the kept span and every summarised tool call has its results summarised with it. The kept span SHALL always include the newest user message.

#### Scenario: Random histories
- **WHEN** compaction cut points are computed over many random histories of user, assistant tool-call and tool-result messages
- **THEN** no kept tool result lacks its tool call, and the newest user message is always kept

### Requirement: Compaction triggers proactively and reactively
Before each request the agent SHALL compact when the estimated request size exceeds the context window minus `max(16384, maxOutputTokens)`. On a `context_overflow` response it SHALL compact once and retry the step; a second overflow in the same turn SHALL fail the turn. When the window is unknown the agent SHALL not compact proactively and SHALL log one warning. A failed summary SHALL leave the session unchanged. Compaction SHALL emit `session.compaction.started` and `session.compaction.completed` events.

#### Scenario: Proactive
- **WHEN** the estimate crosses the threshold before a request
- **THEN** a summary request is made, a compaction entry is appended, and the following request starts with the summary

#### Scenario: Reactive
- **WHEN** the provider answers a 400 context overflow
- **THEN** the agent compacts and retries once, and a second overflow fails the turn with `context_overflow`

#### Scenario: Unknown window
- **WHEN** no context window is known
- **THEN** no proactive compaction happens and one warning is logged

### Requirement: The summary is structured and iterative
The summary request SHALL use the same model and profile without tools, SHALL pass the previous summary when one exists, SHALL cut tool results in the summarised span to 2000 characters, and SHALL ask for Goal, Constraints, Progress, Decisions, Files, Next steps and Critical context. Read and modified file lists SHALL be accumulated by code across compactions.

#### Scenario: Second compaction
- **WHEN** a session that already has a compaction is compacted again
- **THEN** the summary request contains the previous summary and the file lists include files from both spans

### Requirement: Old tool output is pruned only in the projection
Above 70 % of the window the agent SHALL replace tool results older than the newest 40k tokens of tool output with a stub naming the original size, provided this saves at least 20k tokens. Below 70 % nothing SHALL be pruned. The session file SHALL never be modified by pruning.

#### Scenario: Below threshold
- **WHEN** the estimate is under 70 % of the window
- **THEN** the request body contains every tool result unchanged

#### Scenario: Above threshold
- **WHEN** the estimate is over 70 % and old tool results total more than 20k tokens
- **THEN** those results appear as stubs in the request and in full in the session file

### Requirement: Token counting prefers the provider's numbers and counts tool schemas
The agent SHALL estimate with js-tiktoken and a safety margin, SHALL use the provider's `prompt_tokens` plus an estimate of later messages once a response exists, and SHALL include the serialised tool schemas in every estimate.

#### Scenario: Weaver-sized tool set
- **WHEN** about 40 tool schemas are supplied and no response has been received
- **THEN** the estimate includes their tokens

### Requirement: Instructions and skills load lazily
The first successful `read`, `edit` or `write` in a directory SHALL append the nearest not-yet-loaded `AGENTS.md` files up to the worktree root to the tool result, once each, capped at 32 KiB. Skills in `<home>/.agents/skills` SHALL be listed by name and description in the system prompt and their bodies returned by a `skill` tool.

#### Scenario: Nested AGENTS.md once
- **WHEN** two files in the same subdirectory are read
- **THEN** the first result carries that directory's `AGENTS.md` and the second does not

#### Scenario: Skill tool
- **WHEN** the model calls `skill` with an indexed name
- **THEN** the result is the skill body and its directory

### Requirement: The system prompt is small and byte-stable
The fixed preamble SHALL be at most 1200 tokens excluding the AGENTS text and the skill index, and the system message SHALL be byte-identical across the requests of a session.

#### Scenario: Two requests
- **WHEN** two consecutive requests are recorded
- **THEN** their system messages are equal

### Requirement: Prompt caching follows the profile
A profile flag `promptCache` SHALL select `none`, `key` (send `prompt_cache_key` equal to the session id) or `anthropic` (send `cache_control` markers on the system message, last tool and last user block). Nothing SHALL be sent when the flag is `none` or unset. Cached prompt tokens SHALL be read from `cachedTokensField` and reported in `TurnResult.usage.firstRequest`.

#### Scenario: Key mode
- **WHEN** `promptCache` is `key`
- **THEN** every request body carries `prompt_cache_key` equal to the session id

#### Scenario: Cached usage
- **WHEN** the first response reports cached tokens
- **THEN** `usage.firstRequest.cachedTokens` equals that number

### Requirement: The adapter compacts, forks, describes and expires sessions
The adapter SHALL implement `compactSession` by running the child in compact mode, `forkSession` by copying the session file under a new id, and `describeSession` by reading the file. It SHALL declare `forkSessions` and `contextCompactionAt`. Session files not used for 30 days, configurable through `sessionRetentionDays`, SHALL be deleted at child start, never the current session.

#### Scenario: Fork
- **WHEN** a session is forked
- **THEN** the new ref points at a new file whose entries equal the original's

#### Scenario: Retention
- **WHEN** a session file is 31 days old and another is 2 days old
- **THEN** only the older one is removed at the next child start

### Requirement: Long sessions hold at the weaver's scale
A history of 500 or more messages with about 40 `weave_*` tool schemas SHALL compact, resume and continue without losing the last human message, and a weaver-kind turn that calls `weave_human_send` SHALL complete through the loopback MCP.

#### Scenario: 500-message weaver history
- **WHEN** a 500-message session with the weaver tool set exceeds the trigger
- **THEN** it compacts, the next request starts with the summary and includes the newest user message, and the turn continues

#### Scenario: Human send
- **WHEN** the model calls `weave_human_send`
- **THEN** the tool call reaches the mock MCP server and its result is fed back to the model

### Requirement: MCP servers are declared in workspace config with secrets by reference

The workspace config SHALL carry an `mcpServers` map from a server name to a definition with `type` (`http` or `stdio`), `url` and `headers` for HTTP, `command`, `args` and `env` for stdio, `listTimeoutMs`, `callTimeoutMs` and `readOnly`. The schema SHALL require `command` for a stdio server and `url` for an HTTP server, SHALL refuse the reserved run-scoped name `weave-ai`, and SHALL refuse unknown keys. A value in a server's `env` or `headers` MAY contain a `${SECRET_NAME}` reference; a referenced name SHALL be a valid workspace secret name, and a literal secret value SHALL NOT be required or accepted as the only spelling of a secret. A server definition SHALL NOT contain a secret value.

#### Scenario: A stdio server without a command is refused
- **WHEN** a workspace config defines an `mcpServers` entry with `type: stdio` and no `command`
- **THEN** validation fails and names that field

#### Scenario: An HTTP server without a url is refused
- **WHEN** a workspace config defines an `mcpServers` entry with `type: http` and no `url`
- **THEN** validation fails and names that field

#### Scenario: The reserved Weave name is refused
- **WHEN** a workspace config defines an `mcpServers` entry named `weave-ai`
- **THEN** validation fails, because that name is the run-scoped server's and cannot be overridden

### Requirement: A run is given only the MCP servers its role allows

A role SHALL carry an `mcpServers: string[]` allow list, defaulting to none. A workspace-level weaver allow list SHALL name the servers the weaver may use. A `weave`-runtime run SHALL receive exactly the servers named by its role's list — or by the weaver list when the run is the weaver — that also exist in `mcpServers`, plus the run-scoped `weave-ai` entry. A named server with no matching definition SHALL be ignored with a log and SHALL NOT fail the run. A persistent session SHALL be covered by its role's list. An allow list SHALL NOT select a server for any runtime other than `weave`.

#### Scenario: A role with no servers gets none
- **WHEN** a role's `mcpServers` is empty and it runs a `weave` turn
- **THEN** the run's `mcpServers` contains only the run-scoped `weave-ai` entry

#### Scenario: A role's allowed server is present
- **WHEN** a role names a configured server in its `mcpServers` and a `weave` turn runs for it
- **THEN** the run's `mcpServers` contains that server and the run-scoped `weave-ai` entry, and no other user server

#### Scenario: An unknown name does not fail the run
- **WHEN** a role names a server that is not defined in the workspace config
- **THEN** the run starts without it and a log records the missing name

### Requirement: Server secrets are resolved at run time and never reach a transcript or file

The engine SHALL resolve every `${SECRET_NAME}` reference in an allowed server's `env` and `headers` from the workspace secret store, SHALL add each resolved value to the run's redaction set, and SHALL pass the server its own `env` on top of the minimal server base only — never the run token and never the provider key. A server whose referenced secret has no stored value SHALL be omitted from the run with a log, so it never starts unauthenticated. The run's `mcp.json` SHALL record the definitions with references and redactions, never a resolved secret value, and no resolved value SHALL appear in an event, a log line or a transcript.

#### Scenario: A referenced secret reaches the server and is redacted
- **WHEN** a server's `env` references a stored workspace secret and the server reports its own environment in a tool result
- **THEN** the server's environment carries the secret's value and the run's events and log lines carry it only as `[redacted]`

#### Scenario: The run token and provider key are absent from a server's environment
- **WHEN** a stdio server lists its own environment during a turn
- **THEN** neither the run token nor the provider key variable is present

#### Scenario: A missing secret omits the server
- **WHEN** a server references a secret that has no stored value
- **THEN** the server is not offered to the run, the run continues, and a log records the missing reference

#### Scenario: No secret is written to mcp.json
- **WHEN** a run with a secret-referencing server writes its `mcp.json`
- **THEN** the file contains the reference and no resolved value

### Requirement: A server's timeouts are configurable and reach the client

A server definition's `listTimeoutMs` SHALL bound `initialize` and `tools/list` and `callTimeoutMs` SHALL bound `tools/call`, defaulting to 30 s and 60 s when unset. The values SHALL travel from workspace config through the run's `mcpServers` to the child's MCP client without changing the child protocol version.

#### Scenario: A configured call timeout is applied
- **WHEN** a server is configured with a `callTimeoutMs` and a tool call exceeds it
- **THEN** the call fails with the timeout rather than the default

### Requirement: A running turn accepts live input and delivers it at a request boundary

The child SHALL keep reading its stdin after `init`, and a `send` line SHALL queue its text for the running turn. Queued text SHALL be appended to the session as user messages at a request boundary, after the previous step's tool results, so the model sees it in the next request. When a step produces no tool calls and the queue is non-empty, the turn SHALL continue instead of ending. The adapter's `TurnHandle.send` SHALL write the `send` line and resolve `delivered` while the child runs, and SHALL resolve `closed` without writing once the child's `result` line has been seen or its stdin has closed. Live input SHALL never break the history: every queued message is a plain user message and every persisted history remains valid.

#### Scenario: Delivered after the tool results

- **WHEN** a `send` arrives while a tool call runs and the model is asked again
- **THEN** the next request body contains the sent text after the tool result, and the turn's answer addresses it

#### Scenario: No tool call pending

- **WHEN** a step ends with no tool calls and the queue holds text
- **THEN** the text is appended and the turn asks the model again instead of ending

#### Scenario: Closed after the result

- **WHEN** `send` is called after the child's `result` line has been seen
- **THEN** it resolves `closed` and nothing is written to the child

#### Scenario: A human steers the weaver mid-turn

- **WHEN** a weaver-kind turn is running and a human message is delivered to it mid-turn
- **THEN** the turn answers that message in the same turn and the session history is valid

### Requirement: The final report can be produced as structured output

When `init` carries an `outputSchema`, the child SHALL add a `submit_result` tool whose parameter schema is that schema, SHALL instruct the model to call it last, and SHALL offer it in every permission mode regardless of a role's tool allow list. A call whose arguments satisfy the schema SHALL populate the result's `structured` field and end the turn, with an ordinary tool result persisted so the tool call stays paired. A call whose arguments do not satisfy the schema SHALL return a corrective tool result naming each violation, and SHALL be corrected at most twice; a third invalid call SHALL fail the turn with `tool_call_invalid` in family `tooling`. When the model ends the turn with text and no `submit_result`, the child SHALL ask it once more, at most twice. The run engine SHALL carry the schema only for a turn that owes a report — a worker, the weaver, a planner, or a session that holds a ticket — and never for a ticketless persistent session.

#### Scenario: Valid report

- **WHEN** the model calls `submit_result` with arguments satisfying the run's schema
- **THEN** the turn result's `structured` is those arguments and the turn ends

#### Scenario: Invalid arguments corrected twice then failed

- **WHEN** the model calls `submit_result` three times with arguments that violate the schema
- **THEN** the first two results name the violations and the third fails the turn `tool_call_invalid`

#### Scenario: Nudged once when the model stops without submitting

- **WHEN** the model answers with text, calls no tool, and the schema has not been satisfied
- **THEN** the child asks it to call `submit_result` again rather than ending the turn

#### Scenario: Offered in restricted mode

- **WHEN** a turn with an `outputSchema` runs in `restricted` mode
- **THEN** the recorded request body's tool list includes `submit_result`

#### Scenario: A ticketless session is not forced to report

- **WHEN** a ticketless persistent session runs a turn
- **THEN** its turn carries no output schema, the request offers no `submit_result` tool, and the turn is never nudged for a report

### Requirement: A todo tool replaces the run's list

The child SHALL offer a `todo_write` tool that takes a list of items, each with `content` and a `status` of `pending`, `in_progress` or `completed`. A call SHALL replace the run's whole todo list and SHALL return a summary of the new list. `todo_write` SHALL change no file and run no command, SHALL be available in every permission mode including `restricted`, and SHALL emit a `plan.proposed` run event carrying the items, matching the event the codex runtime emits for its todo list.

#### Scenario: Replaces the list

- **WHEN** `todo_write` is called with a new list after an earlier call
- **THEN** the run's list is the new one and the result summarises it

#### Scenario: Available in restricted mode

- **WHEN** a turn runs in `restricted` mode
- **THEN** the recorded request body's tool list includes `todo_write`

#### Scenario: Plan event

- **WHEN** `todo_write` is called
- **THEN** a `plan.proposed` event is emitted carrying the supplied items
