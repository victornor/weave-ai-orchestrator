# live-run-progress Specification

## Purpose
Defines what a page showing a running run must display at every moment, and the partial-output contract by which a runtime, the daemon and the page achieve it. A run that is healthy must never look idle, and a run that is stuck must be distinguishable from one that is busy.

## Requirements

### Requirement: A live run never shows a bare working state
While a run is live, its page SHALL render a live activity row derived from the run's events and partial output: the current state, the turn's elapsed time, the number of tool calls so far, and the time since the last event. The state SHALL be one of: streaming text, thinking, waiting on the model (shown as `Working` with its elapsed seconds), running a named tool (with its target and elapsed seconds), or an explicit statement that the runtime reports whole steps only. The row SHALL update on a one-second clock without any network activity and SHALL NOT poll.

#### Scenario: Model is generating between steps
- **WHEN** the last event is a completed tool result and nothing has arrived for 4 s
- **THEN** the row reads "Working" with 4 s elapsed and a turn total

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
Each runtime adapter SHALL declare `capabilities.partialOutput` as `none`, `text` or `full`, and the value the page reads SHALL agree with that declaration. opencode (`full`), Claude (`full`), Codex (`full`), Cursor (`text`) and Gemini (`text`) are delivered; every other runtime SHALL show the "whole steps only" state until its own follow-up change declares partial output.

#### Scenario: Claude now streams
- **WHEN** a Claude run is live and generating text
- **THEN** the page shows the streaming text and the streaming state, not the whole-steps-only statement

#### Scenario: Codex now streams
- **WHEN** a Codex run is live and its app-server is running
- **THEN** the page shows streaming text, reasoning and running tools, not the whole-steps-only statement

#### Scenario: Cursor streams text
- **WHEN** a cursor run is generating assistant text
- **THEN** the page shows the growing text and the row reads as writing, not as "whole steps only"

#### Scenario: Gemini streams text
- **WHEN** a gemini run is generating assistant text
- **THEN** the page shows the growing text and the row reads as writing, not as "whole steps only"

#### Scenario: Unsupported runtime
- **WHEN** a run of a runtime that declares `none` is live
- **THEN** the page shows the whole-steps-only statement, elapsed time, tool count and time since the last event

### Requirement: The weaver chat is a live run surface
The weaver chat SHALL render a live run through the same partial-output path as every other run surface: the live activity row (state, turn elapsed, tool count, time since the last event) and the partial text and reasoning still being generated, from the run's events and partial output. It SHALL NOT render a bare "working" state while the run is live. Streaming SHALL affect only what the run view shows: partial output SHALL NOT create or edit a thread message, and SHALL NOT reach the human channel — the weaver's words reach a human only when it sends them.

#### Scenario: Mid-turn weaver reply
- **WHEN** the weaver is generating a reply and its run has live partial text
- **THEN** the chat shows the streaming text and the live activity row, and no thread message exists for that text until the weaver sends one

#### Scenario: Runtime id resolves coverage
- **WHEN** the chat's live run is on a runtime that declares no partial output
- **THEN** the chat's row says so in words and still shows elapsed time, tool count and time since the last event

### Requirement: A running tool's output can stream as `tool_output` partials
`RuntimePartial.kind` and `run.delta` part kinds SHALL include `tool_output`: the appended output of a tool still running, keyed by a `partId` that the tool's completed `tool.result` carries in its payload. The engine SHALL coalesce, redact and drop these exactly like other partials, including a secret split across two chunks, and SHALL NOT store them. The page SHALL show the last lines of a running tool's `tool_output` and remove them when the result arrives.

#### Scenario: Secret split across chunks
- **WHEN** a known secret arrives split over two `tool_output` fragments
- **THEN** no frame shows any part of it unmasked, and a frame released after the second fragment shows the mask

#### Scenario: Result supersedes
- **WHEN** `tool.result` arrives with the partial's `partId`
- **THEN** the run's live snapshot no longer contains it

### Requirement: Whether a run can stream is read from its runtime's declared capability
Consumers that must say whether a runtime streams partial output (the daemon's activity summary, the web UI, the TUI, the CLI) SHALL read the adapter's `capabilities.partialOutput`, not a table keyed by runtime id. A runtime that declares none SHALL be treated as reporting whole steps only. The per-runtime table in `@weave-ai/shared` SHALL NOT remain a second source of truth.

#### Scenario: A new runtime
- **WHEN** an adapter declares `partialOutput: 'full'` and no shared package is edited
- **THEN** its live run row shows streaming state, not "whole steps only"

#### Scenario: Existing runtimes unchanged
- **WHEN** the capability is read for opencode, claude, codex, cursor and gemini
- **THEN** the values are `full`, `full`, `full`, `text`, `text`
