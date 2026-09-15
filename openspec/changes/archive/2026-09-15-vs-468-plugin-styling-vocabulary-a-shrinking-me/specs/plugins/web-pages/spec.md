## ADDED Requirements

### Requirement: The table's metadata cell shrinks and truncates without crowding out the row

The `.v2-table` recipe SHALL style its metadata (`secondary`) cell so it may shrink after the
`primary` cell keeps a minimum width, truncating its own text with an ellipsis and keeping its muted,
monospace look. The cell SHALL NOT wrap its text. At a narrow viewport the `primary` cell and the
`actions` cell SHALL remain visible, and the table and its page SHALL NOT scroll horizontally.

#### Scenario: A long metadata value truncates rather than wrapping

- **WHEN** a row's `secondary` cell holds a value wider than the row at a phone width
- **THEN** the cell's text is truncated with an ellipsis on one line

#### Scenario: The primary cell and the actions stay visible at a phone width

- **WHEN** a row with a long `secondary` value, a `primary` value and an `actions` cell is rendered
  at 390px
- **THEN** the `primary` cell is visible at a non-zero width
- **AND** every button in the `actions` cell is fully inside the viewport

#### Scenario: Short values do not wrap at a wide viewport

- **WHEN** a row with short `primary` and `secondary` values is rendered at 1440px
- **THEN** neither cell wraps to a second line

#### Scenario: An existing page keeps its look where it already fits

- **WHEN** a plugin page written to today's vocabulary is rendered at a width its rows already fit
- **THEN** the row renders as it did before this change

### Requirement: The table recipe includes an inline row panel role

`WEAVE_PLUGIN_CLASS` SHALL include a panel role naming a `v2-*` class, and the `.v2-table` recipe
SHALL style that class as a full row-width region a plugin places after a row inside the table,
divided from the row above exactly as rows are divided from one another. Its form fields SHALL be
laid out with the host's own form-row role, so a plugin opens an edit form under a row without
adding a card or any CSS of its own. The daemon-generated plugin stylesheet SHALL carry the panel
rule, derived from `packages/ui/src/v2/v2.css`.

#### Scenario: The panel class is published and styled

- **WHEN** the SDK's class vocabulary and the generated plugin stylesheet are inspected
- **THEN** the vocabulary names a panel class and the stylesheet contains a rule for it

#### Scenario: A panel divides from its row

- **WHEN** a `.v2-table` contains a row followed by a panel
- **THEN** the panel spans the table's full width
- **AND** a divider separates the row from the panel

#### Scenario: Fields in a panel look like a settings form

- **WHEN** a panel holds the host's form-row role for its fields
- **THEN** the fields render with the host's settings-form label and input layout, with no CSS
  defined by the plugin

### Requirement: The table's actions cell groups small buttons, right-aligned with a consistent gap

The `.v2-table` recipe's `actions` cell SHALL lay out two or more controls as a single right-aligned
group with a consistent gap, SHALL NOT wrap them onto a second line, and SHALL NOT shrink the
controls below their own size. Every control in the group SHALL stay inside the table's width at a
phone viewport.

#### Scenario: A two-button group is right-aligned and evenly spaced

- **WHEN** a row's `actions` cell holds two compact buttons
- **THEN** both buttons sit at the row's trailing edge with the same gap between them
- **AND** neither has wrapped to a second line

#### Scenario: The action group stays on screen at a phone width

- **WHEN** a row with a two-button action group is rendered at 390px
- **THEN** both buttons are fully inside the viewport and the table does not scroll horizontally
