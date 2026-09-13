## ADDED Requirements

### Requirement: A side-by-side diff keeps every line inside its own column

When an edit tool call's diff renders side by side, each side SHALL keep its lines within its own
column at any width: a line with more text than the column can show on one row SHALL wrap inside
that column, continuing under the code rather than under the line-number gutter, and SHALL NOT be
drawn across the divider into the other side. A unified diff rendered in a transcript cell SHALL
wrap the same way rather than overflow the cell.

A width at which two code columns do not each read SHALL render as one column instead; the
side-by-side choice is only made when the space rendering the diff is wide enough for two readable
code columns at the diff's own monospace size.

The pull-request diff view's own unified layout MAY keep horizontal scrolling instead of wrapping;
that is a choice for that view, not a relaxation of this requirement for a transcript.

#### Scenario: A long line in a side-by-side diff

- **WHEN** a side-by-side diff shows a line whose text is wider than its column
- **THEN** the text wraps within that column, under the code, and does not cross the divider

#### Scenario: A long line in a unified transcript diff

- **WHEN** a unified diff in a transcript cell shows a line wider than the cell
- **THEN** the text wraps within the cell rather than overflowing it

#### Scenario: A very long unbroken token

- **WHEN** a diff line contains a single token wider than the column
- **THEN** the token breaks within the column and does not push its column or the other side wider
  than the diff's container

#### Scenario: Two columns do not each read

- **WHEN** a diff renders in a space too narrow for two readable code columns at the diff's
  monospace size
- **THEN** it renders as a single column rather than as an unreadable side-by-side pair
