## MODIFIED Requirements

### Requirement: Runtime coverage is declared
Each runtime adapter SHALL declare `capabilities.partialOutput` as `none`, `text` or `full`, and the value the page reads SHALL agree with that declaration. opencode (`full`) and Claude (`full`) are delivered; every other runtime SHALL show the "whole steps only" state until its own follow-up change declares partial output.

#### Scenario: Claude now streams
- **WHEN** a Claude run is live and generating text
- **THEN** the page shows the streaming text and the streaming state, not the whole-steps-only statement

#### Scenario: Unsupported runtime
- **WHEN** a codex run is live before its follow-up lands
- **THEN** the page shows the whole-steps-only statement, elapsed time, tool count and time since the last event

## ADDED Requirements

### Requirement: The weaver chat is a live run surface
The weaver chat SHALL render a live run through the same partial-output path as every other run surface: the live activity row (state, turn elapsed, tool count, time since the last event) and the partial text and reasoning still being generated, from the run's events and partial output. It SHALL NOT render a bare "working" state while the run is live. Streaming SHALL affect only what the run view shows: partial output SHALL NOT create or edit a thread message, and SHALL NOT reach the human channel — the weaver's words reach a human only when it sends them.

#### Scenario: Mid-turn weaver reply
- **WHEN** the weaver is generating a reply and its run has live partial text
- **THEN** the chat shows the streaming text and the live activity row, and no thread message exists for that text until the weaver sends one

#### Scenario: Runtime id resolves coverage
- **WHEN** the chat's live run is on a runtime that declares no partial output
- **THEN** the chat's row says so in words and still shows elapsed time, tool count and time since the last event
