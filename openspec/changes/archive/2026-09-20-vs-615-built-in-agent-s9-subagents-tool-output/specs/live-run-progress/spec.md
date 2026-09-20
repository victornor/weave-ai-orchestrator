## ADDED Requirements

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
