## MODIFIED Requirements

### Requirement: Model ids get a derived human-readable label

Every `RuntimeModel` this adapter returns SHALL carry a `label` distinct from a raw, unlabelled
id. When `--list-models` output reports a display name alongside an id (the `<id> - <displayName>`
line shape), that reported display name SHALL be used as the label as-is — not re-derived or
overwritten. Only when a `--list-models` line carries no display name (a bare id with no ` - `
segment), or for the static fallback list (which has no live CLI output to read a name from),
SHALL the label be derived algorithmically from the id (its family word plus any recognized
variant/tier suffix), as before. This SHALL still apply to every id from either path, so a model
id neither list's author anticipated still reads as something recognizable rather than as a raw
id.

#### Scenario: A known id reads as its brand name

- **WHEN** the id is `cursor-grok-4.6-high-fast`
- **THEN** the derived label contains "Grok 4.6"

#### Scenario: An unrecognized id still gets a readable label

- **WHEN** the id is one `--list-models` reports with no ` - <displayName>` segment, and it
  matches no known family word
- **THEN** the derived label is a humanized form of the id (not the raw id string, and not empty)

#### Scenario: A reported display name is used as-is, not re-derived

- **WHEN** `--list-models` output includes the line `gpt-5.2 - GPT-5.2`
- **THEN** the returned label for id `gpt-5.2` is exactly `GPT-5.2`, the CLI's own reported name
- **AND** it is not passed through the algorithmic humanizer

#### Scenario: A bare id line still falls back to the humanizer

- **WHEN** `--list-models` output includes a line with no ` - <displayName>` segment
- **THEN** the returned label for that id is the algorithmically derived label, as before this
  change
