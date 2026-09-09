## ADDED Requirements

### Requirement: A turn's trailing structured report renders as a collapsed detail

When an expanded turn's trace includes the agent's end-of-turn structured report — the fenced JSON
block every turn ends with, carrying its run state, summary, ticket updates, next action and
knowledge disposition — the trace SHALL render it as a collapsed, expandable detail in the same
visual register as a tool call, never as a plain paragraph of conversational text.

Collapsed, it SHALL show a one-line summary that does not require expansion to read: at minimum the
report's run state. Expanding it SHALL show the report's full content.

A block of assistant text that is not the turn's structured report SHALL continue to render as
ordinary transcript text, unaffected by this requirement.

#### Scenario: A turn ending with its structured report

- **WHEN** a human expands a turn's trace and that turn's final assistant output is its end-of-turn
  structured report
- **THEN** the report appears as a collapsed one-line detail rather than a raw JSON paragraph

#### Scenario: Expanding the report detail

- **WHEN** the human expands the collapsed report detail
- **THEN** the report's full content is shown

#### Scenario: Ordinary assistant text is unaffected

- **WHEN** a turn's trace includes assistant text that does not parse as the structured report
- **THEN** that text renders as it does today, with no collapsing applied
