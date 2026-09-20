# live-run-progress Specification

## Purpose
Defines what a page showing a running run must display at every moment, and the partial-output contract by which a runtime, the daemon and the page achieve it. A run that is healthy must never look idle, and a run that is stuck must be distinguishable from one that is busy.

## Requirements

### Requirement: A live run never shows a bare working state
While a run is live, its page SHALL render a live activity row derived from the run's events and partial output: the current state, the turn's elapsed time, the number of tool calls so far, and the time since the last event. The state SHALL be one of: streaming text, thinking, waiting for the model (with elapsed seconds), running a named tool (with its target and elapsed seconds), or an explicit statement that the runtime reports whole steps only. The row SHALL update on a one-second clock without any network activity and SHALL NOT poll.

#### Scenario: Model is generating between steps
- **WHEN** the last event is a completed tool result and nothing has arrived for 4 s
- **THEN** the row reads "waiting for the model" with 4 s elapsed and a turn total, not "working"

#### Scenario: A long turn that never narrates
- **WHEN** a run has made 50 tool calls over five minutes and emitted no assistant text
- **THEN** the row shows the running tool with its command or path, the count 50, the turn elapsed time and the time since the last event

#### Scenario: Runtime cannot stream
- **WHEN** the run's runtime declares no partial output
- **THEN** the row says so in words and still shows elapsed time, tool count and time since the last event

### Requirement: A tool shows as running when it starts
An adapter SHALL emit `tool.call` when a tool starts, with its input when known, and `tool.result` when it completes. The page SHALL render the tool with a spinner and its elapsed time until the result arrives, then complete it in place.

#### Scenario: Slow tool
- **WHEN** a shell tool starts and takes 3 s
- **THEN** the page shows it running, with its command, within one second of the start and completes the same row when it ends

### Requirement: Partial output is ephemeral and coalesced
A runtime MAY report partial text, reasoning and tool-input through `TurnSink.onPartial`. The engine SHALL coalesce partials per part (at most one frame per 50 ms per run) and broadcast them as `run.delta` frames on the workspace event stream. Partials SHALL NOT be written to `run_events` or the events file. The completed event for a part SHALL supersede its partials on the page, so a completed part renders exactly once.

#### Scenario: Streaming then completion
- **WHEN** a text part streams in four deltas and then completes
- **THEN** the page shows the growing text, and after the completed `assistant.text` event it shows that text once, with no duplicate

#### Scenario: Write rate
- **WHEN** a runtime emits 200 deltas in one second
- **THEN** at most 20 `run.delta` frames leave the daemon for that run and zero rows are added to `run_events`

### Requirement: A reconnecting page recovers the partial in flight
`GET /runs/:id/live` SHALL return the in-memory partial buffers of a live run. A page that reconnects, or opens mid-step, SHALL read it once and then follow `run.delta` frames. A run that has finished returns none.

#### Scenario: Page opened mid-step
- **WHEN** a page opens while a text part is half generated
- **THEN** it shows the text so far and continues from the next frame

### Requirement: A cut-off stream does not corrupt the run
If a runtime's partial stream ends without a completed part, the page SHALL discard that partial when the turn ends and the run's outcome SHALL be decided exactly as without partials. Cancelling a run mid-stream SHALL clear its partials.

#### Scenario: Cancel mid-stream
- **WHEN** a run is cancelled while text is streaming
- **THEN** the run is cancelled as before and the page shows no partial text after the cancellation event

### Requirement: Runtime coverage is declared
Each runtime adapter SHALL declare `capabilities.partialOutput` as `none`, `text` or `full`, and the value the page reads SHALL agree with that declaration. opencode (`full`) and Claude (`full`) are delivered; every other runtime SHALL show the "whole steps only" state until its own follow-up change declares partial output.

#### Scenario: Claude now streams
- **WHEN** a Claude run is live and generating text
- **THEN** the page shows the streaming text and the streaming state, not the whole-steps-only statement

#### Scenario: Unsupported runtime
- **WHEN** a codex run is live before its follow-up lands
- **THEN** the page shows the whole-steps-only statement, elapsed time, tool count and time since the last event

### Requirement: The weaver chat is a live run surface
The weaver chat SHALL render a live run through the same partial-output path as every other run surface: the live activity row (state, turn elapsed, tool count, time since the last event) and the partial text and reasoning still being generated, from the run's events and partial output. It SHALL NOT render a bare "working" state while the run is live. Streaming SHALL affect only what the run view shows: partial output SHALL NOT create or edit a thread message, and SHALL NOT reach the human channel — the weaver's words reach a human only when it sends them.

#### Scenario: Mid-turn weaver reply
- **WHEN** the weaver is generating a reply and its run has live partial text
- **THEN** the chat shows the streaming text and the live activity row, and no thread message exists for that text until the weaver sends one

#### Scenario: Runtime id resolves coverage
- **WHEN** the chat's live run is on a runtime that declares no partial output
- **THEN** the chat's row says so in words and still shows elapsed time, tool count and time since the last event
