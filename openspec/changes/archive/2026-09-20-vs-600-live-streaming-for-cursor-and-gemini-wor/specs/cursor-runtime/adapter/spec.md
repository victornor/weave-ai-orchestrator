## ADDED Requirements

### Requirement: A cursor turn streams assistant text as it is generated

The adapter SHALL pass `--stream-partial-output` on every turn, which the installed `cursor-agent` accepts only alongside the `--print` and `--output-format stream-json` flags this adapter already sets. The adapter SHALL report each assistant text delta through `TurnSink.onPartial` with a stable `partId` per assistant message, and SHALL declare `capabilities.partialOutput` as `'text'` — assistant text only, no reasoning and no tool-input partials.

The parser SHALL NOT persist a delta as its own `assistant.text`. Per assistant message it SHALL emit exactly one persisted `assistant.text` carrying the whole message text and the same `partId` the deltas used, so the completed event supersedes the partial on the page. The whole-message text is the CLI's own flush of the accumulated model-call text (the `assistant` event it writes before a tool call and at turn end); an `assistant` text event whose text equals the accumulated deltas is that flush, and any other is a delta. A turn with no text SHALL emit no `assistant.text`.

A stream that ends without a flush SHALL leave the run's outcome and `finalText` exactly as without partials, and cancelling a run mid-stream SHALL clear its partials. Session resume, model-mismatch and no-output handling SHALL be unchanged. Partial text SHALL carry the same secret redaction as persisted events.

#### Scenario: Text arrives as it is generated

- **WHEN** the parser is fed a `--stream-partial-output` stream of several `assistant` text deltas followed by the flush event
- **THEN** each delta is reported once through `onPartial` with the message's `partId`
- **AND** the flush produces a single persisted `assistant.text` with the whole text and the same `partId`
- **AND** no delta is persisted as its own `assistant.text`

#### Scenario: A completed message renders once

- **WHEN** a page holds the partial for a `partId` and then receives the persisted `assistant.text` carrying it
- **THEN** the partial is dropped and the message renders exactly once

#### Scenario: The invocation streams only in print stream-json mode

- **WHEN** `buildArgs` runs for a turn
- **THEN** the args include `--stream-partial-output` alongside `-p` and `--output-format stream-json`

#### Scenario: A cut-off stream keeps what it produced

- **WHEN** the stream ends after a delta but before any flush
- **THEN** the run's outcome and error classification are exactly as without partials
- **AND** the text produced so far is preserved in the turn's final text

#### Scenario: Cancel mid-stream clears the partials

- **WHEN** a cursor turn is cancelled while text is streaming
- **THEN** the engine clears the run's partials and the page shows no partial text after the cancellation

#### Scenario: The declaration matches the page's coverage table

- **WHEN** the adapter's capabilities are read
- **THEN** `partialOutput` is `'text'` and equals the page coverage table's entry for `cursor`

#### Scenario: A secret split across deltas never shows

- **WHEN** a registered secret is split across two consecutive text deltas
- **THEN** no `run.delta` frame releases text containing the secret
