# builtin-agent Specification

## Purpose
Weave AI's own agent client, so a turn can run on any OpenAI-compatible Chat Completions endpoint without a third-party coding CLI. Slice 1 is the walking skeleton: one real streamed turn with `weave_*` tools over the run-scoped MCP server, cancel, and resume.

## ADDED Requirements

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
The API key SHALL travel only in the `init` line on stdin. It SHALL NOT appear in the child's argv or environment, and SHALL NOT be present in the environment of the `bash` tool or in any log line, event or session file.

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
The `weave` adapter SHALL declare `resumableSessions: true`, `streamingInput: false`, `mcp: true`, `usageReporting: 'per_turn'`, `costReporting: false` and `partialOutput: 'full'`; `TurnHandle.send` SHALL be omitted or resolve `unsupported`. Model ids SHALL be `providerId/modelId` from workspace `providers` config. `detect()` SHALL be `available` only when the child entry exists and a provider is configured.

#### Scenario: No provider configured
- **WHEN** the workspace has no `providers` entry
- **THEN** `detect()` reports `unsupported` with a note
