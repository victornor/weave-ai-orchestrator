# web-v2/work — delta

## RENAMED Requirements

- FROM: `### Requirement: Empty columns are narrow and cards widen them`
- TO: `### Requirement: Kanban columns share the pane equally, with a 236px minimum`

## MODIFIED Requirements

### Requirement: Kanban columns share the pane equally, with a 236px minimum

Every kanban column SHALL take an equal share of the board's usable width, so all columns render at
the same width as each other whether they are empty or hold cards — a board where only Done has cards
SHALL show six equal columns, never a Done column stretched across the pane. The columns SHALL grow
together to fill the pane, leaving no empty space to the right of the last column. Each column SHALL
have a minimum width of 236px; when the pane is narrower than six times 236px the columns SHALL
render at 236px and the board SHALL scroll horizontally rather than shrink them. An empty column
SHALL be styled identically to the others — no tint, no "Empty" label, no placeholder text — and
SHALL be the same width as its neighbours. A card SHALL fill its column's width, keeping its internal
layout and truncation. The board SHALL NOT cap the column width, so the columns keep filling the pane
on the widest displays.

#### Scenario: Equal columns fill a wide pane

- **WHEN** the kanban renders on a pane wider than six × 236px
- **THEN** every column renders at the same width as each other (±1px) and the columns together fill
  the board's width with no gap wider than 2px to the right of the last column

#### Scenario: An empty column

- **WHEN** a column has no tickets
- **THEN** it renders with its name and a zero count and no card content, with no tint, no "Empty"
  label and no placeholder text, at the same width as the other columns

#### Scenario: A populated column

- **WHEN** a column holds at least one card
- **THEN** it renders wide enough to hold its card and at the same width as the empty columns beside
  it, which are no narrower than it

#### Scenario: A column widens when a card arrives

- **WHEN** a column that was empty gains a ticket, without a reload
- **THEN** the card renders within that column and no column's width changes, because every column
  already shares the pane equally

#### Scenario: At or below the minimum the board scrolls

- **WHEN** the kanban renders on a pane narrower than six × 236px
- **THEN** every column renders at its 236px minimum and the board scrolls horizontally instead of
  shrinking the columns

#### Scenario: A card fills its column

- **WHEN** a card renders in a column
- **THEN** the card spans the column's width, keeping its internal layout and truncation
