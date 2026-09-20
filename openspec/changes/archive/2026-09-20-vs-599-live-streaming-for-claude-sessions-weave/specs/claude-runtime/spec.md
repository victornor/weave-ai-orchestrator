# claude-runtime Specification

## Purpose
Defines what the Claude Code runtime reports while a turn is still being generated: how a Claude turn's streaming protocol becomes partial text, reasoning and tool input, what must never be surfaced, and how a completed part supersedes its partial. It exists so the run page and the weaver chat can show a Claude turn as it happens instead of only once a step finishes.

## ADDED Requirements

### Requirement: A Claude turn requests partial messages and declares full partial output
The Claude adapter SHALL pass `--include-partial-messages` on every `claude -p --output-format stream-json --verbose` turn, in both the headless (`--input-format text`) and live-input (`--input-format stream-json`) forms, and SHALL declare `capabilities.partialOutput` as `full`. The persisted events SHALL remain the completed `assistant`, `user` and `result` lines exactly as before: no streaming fragment SHALL be written as a persisted event, and no streaming fragment SHALL be added to the adapter's accumulated assistant text.

#### Scenario: A headless turn requests partial messages
- **WHEN** the adapter builds a headless turn
- **THEN** its argument list contains `--include-partial-messages`, and its `partialOutput` capability is `full`

#### Scenario: Streaming lines are not persisted as raw events
- **WHEN** a `stream_event` line arrives on stdout
- **THEN** the adapter emits no persisted `runtime.raw` event for it, and a turn that also produces text, thinking and a tool call yields exactly the same persisted event types and count as the same turn without streaming flag set

### Requirement: Streaming text and thinking become partial output under the completed part's id
For each `content_block_delta` that carries a `text_delta` or a `thinking_delta`, the adapter SHALL report a partial of kind `text` or `thinking`, and the matching completed `assistant.text` / `assistant.thinking` event SHALL carry the same `partId`, so the engine supersedes the partial when the completed event is recorded. A `signature_delta` SHALL be consumed and never surfaced as partial output, an event or a log.

#### Scenario: Thinking then text in one message
- **WHEN** a message streams a thinking block and then a text block, each with deltas followed by the whole `assistant` line
- **THEN** partials of kind `thinking` then `text` are reported in that order, the `assistant.thinking` and `assistant.text` events carry the matching `partId`, and no partial text is duplicated in the persisted transcript

#### Scenario: A signature is never surfaced
- **WHEN** a `content_block_delta` of type `signature_delta` arrives
- **THEN** no partial, event or raw record contains the signature value

### Requirement: Tool input streams under the tool call it belongs to
Tool-input deltas (`input_json_delta`) SHALL be reported as partials of kind `tool_input` carrying the tool call id they belong to, sharing the `partId` of the `tool.call` event for that tool, so the partial is dropped when the `tool.call` is recorded. The `tool.call` SHALL carry the tool's full input and SHALL be emitted once per tool, and a `tool.result` for that tool SHALL fold into the same row. A tool SHALL read as running from its `tool.call` until its `tool.result`.

#### Scenario: A tool's arguments stream before the call completes
- **WHEN** a tool-use block streams `input_json_delta` fragments and is then completed by the whole `assistant` line
- **THEN** `tool_input` partials carry the tool's id and its `partId`, exactly one `tool.call` is recorded for the tool with its full input, and the page's partial for that `partId` is gone once that event lands

#### Scenario: A long-running tool stays visible
- **WHEN** a shell tool is called and its result arrives seconds later
- **THEN** the page shows the tool running with its target from the `tool.call` until the `tool.result`, with no second tool row

### Requirement: A cut-off stream leaves the turn's outcome unchanged
If the partial stream ends before a part completes (the CLI exits, is cancelled, or the stream is truncated), the turn SHALL be decided exactly as it is today: the persisted events and the turn result SHALL be unaffected by partials, and a cancelled turn's partials SHALL be cleared with the turn.

#### Scenario: Cancel mid-stream
- **WHEN** a Claude run is cancelled while a text block is streaming
- **THEN** the run is cancelled, its result is the same as without partials, and no partial text survives the cancellation

#### Scenario: CLI exits after deltas without a completed block
- **WHEN** the stream ends after text deltas but before the whole `assistant` line for that block
- **THEN** no `assistant.text` event is invented from the partials, and the turn's exit code, session and error classification are unchanged
