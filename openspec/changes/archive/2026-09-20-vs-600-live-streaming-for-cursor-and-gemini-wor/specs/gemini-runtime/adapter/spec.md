## Purpose

Defines Gemini CLI as a local coding-CLI runtime behind the same adapter contract as the other runtimes, and in particular how a gemini turn reports the assistant text it is still generating, so a running gemini worker page shows progress live.

## ADDED Requirements

### Requirement: A gemini turn streams assistant text as it is generated

Gemini's `stream-json` output emits every assistant chunk as a `message` event carrying `delta: true`; there is no separate completed-message event, and the turn's end is the `result` event. The adapter SHALL report each such chunk through `TurnSink.onPartial` with a stable `partId` per assistant message, and SHALL declare `capabilities.partialOutput` as `'text'` — assistant text only, no reasoning and no tool-input partials.

The parser SHALL NOT persist one `assistant.text` per chunk. It SHALL accumulate an assistant message's chunks and emit exactly one persisted `assistant.text` carrying the whole text and the same `partId` the deltas used, flushing that message when the next non-text event arrives (`tool_use`, `tool_result`, `result`, `error`) and when the process ends. The completed event therefore supersedes the partial, and the transcript renders the message as one block. `finalText` and the `result`-driven usage and error paths SHALL be derived from the same accumulated text as before.

A stream that ends before a message is flushed SHALL still keep the text produced so far, and cancelling a run mid-stream SHALL clear its partials. Session resume SHALL be unchanged. Partial text SHALL carry the same secret redaction as persisted events.

#### Scenario: Text arrives as it is generated

- **WHEN** the parser is fed several assistant `message` events with `delta: true`
- **THEN** each chunk is reported once through `onPartial` with the message's `partId`
- **AND** the page can show the growing text before the message completes

#### Scenario: Chunks coalesce into one persisted block

- **WHEN** a message is flushed on the next `tool_use` or on `result`
- **THEN** exactly one persisted `assistant.text` carries the message's whole text and its `partId`
- **AND** the coalesced deltas render as one text block, not one block per chunk

#### Scenario: A completed message renders once

- **WHEN** a page holds the partial for a `partId` and then receives the persisted `assistant.text` carrying it
- **THEN** the partial is dropped and the message renders exactly once

#### Scenario: A cut-off stream keeps what it produced

- **WHEN** the process ends after some chunks but before any flush
- **THEN** the text produced so far is preserved in the turn's final text and its outcome is unchanged

#### Scenario: Cancel mid-stream clears the partials

- **WHEN** a gemini turn is cancelled while text is streaming
- **THEN** the engine clears the run's partials and the page shows no partial text after the cancellation

#### Scenario: The declaration matches the page's coverage table

- **WHEN** the adapter's capabilities are read
- **THEN** `partialOutput` is `'text'` and equals the page coverage table's entry for `gemini`

#### Scenario: A secret split across chunks never shows

- **WHEN** a registered secret is split across two consecutive text chunks
- **THEN** no `run.delta` frame releases text containing the secret
