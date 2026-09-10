## ADDED Requirements

### Requirement: Consecutive identical tool calls collapse in a live cell's transcript

When a Live cell streams a run's transcript, consecutive tool calls whose tool name is the same
SHALL collapse into one row that shows that name and the number of calls in the run (for example
`Read ×10`). A single call that is not adjacent to another call of the same name SHALL remain a
single row and SHALL NOT show a count.

Activating a counted row SHALL expand it in place to list each invocation, in order, with the same
path or args (and result body) each call shows today. Activating it again SHALL restore the counted
row.

A different tool name SHALL start a new group. A non-tool line (assistant text, a phase marker, a
status line) SHALL also split a run. Order SHALL be preserved.

While events are still arriving, as a run of same-name calls grows, the counted row's number SHALL
update without a page reload.

#### Scenario: Ten consecutive Reads collapse

- **WHEN** a live cell's in-progress run records ten consecutive Read tool calls
- **THEN** the cell shows one counted Read row, not ten separate rows

#### Scenario: Expanding lists each call

- **WHEN** the human activates a counted Read ×10 row
- **THEN** the ten calls are listed in order, each with the path or args it already shows today

#### Scenario: A mixed sequence stays three groups

- **WHEN** a live cell's transcript is Read, then Glob, then Read
- **THEN** it shows three groups, not one

#### Scenario: A single call is not counted

- **WHEN** a live cell's transcript has one Read that is not adjacent to another Read
- **THEN** that call renders as a single row without a count

#### Scenario: The count grows as calls arrive

- **WHEN** a live cell already shows Read ×3 and another consecutive Read arrives
- **THEN** the row becomes Read ×4 without a reload
