## MODIFIED Requirements

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
