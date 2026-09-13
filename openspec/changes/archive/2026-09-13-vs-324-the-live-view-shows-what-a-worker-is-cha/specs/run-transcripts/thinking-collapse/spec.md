## Purpose

Defines how a thinking block renders in a transcript: collapsed by default with its duration when
that duration can be derived, expanding to the model's reasoning text.

## ADDED Requirements

### Requirement: A thinking block renders collapsed with its duration

A transcript SHALL render a thinking block collapsed by default, as one line reading its duration
when that duration is derivable from the run's recorded events. Activating the collapsed line SHALL
expand it to the thinking text, rendered exactly as VS-319 already renders it (markdown, with line
breaks). Activating an expanded block again SHALL collapse it.

A thinking block whose duration cannot be derived SHALL still render collapsed by default, without a
duration figure and without a placeholder in its place.

#### Scenario: A thinking block with a derivable duration

- **WHEN** a transcript includes a thinking block followed by another event, so its duration can be
  derived
- **THEN** it renders collapsed as one line stating that duration

#### Scenario: Expanding a thinking block

- **WHEN** the human activates a collapsed thinking block
- **THEN** it expands to show the thinking text with the same markdown rendering VS-319 already
  produces

#### Scenario: Collapsing again

- **WHEN** the human activates an expanded thinking block
- **THEN** it collapses back to the one-line duration summary

#### Scenario: A thinking block with no derivable duration

- **WHEN** a transcript includes a thinking block whose duration cannot be derived
- **THEN** it still renders collapsed by default, with no duration figure and no placeholder where
  one would go
