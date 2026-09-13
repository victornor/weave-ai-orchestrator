## Purpose

Describes the board's ticket card and phone row carrying, at a glance and without opening the
ticket, what a live worker is doing now, how its latest test run went, and the state of an open pull
request's checks.

## ADDED Requirements

### Requirement: A working card shows what its worker is doing now

Where the board already shows that a worker is live on a ticket — the kanban card and the phone row —
it SHALL show the worker's current activity line beside the working indicator, with the icon the line
names and the relative time since that activity began. The line SHALL be that of the worker the board
already treats as live on the ticket.

When the daemon reports no activity line for a live worker, the card SHALL show no line rather than
inventing one. When the ticket's own state is waiting on a decision, merging or delivering, the card
SHALL show that existing state rather than an activity line.

The line SHALL truncate with an ellipsis rather than wrap, and SHALL NOT make the card taller than the
two extra rows the test tally and pull-request line can occupy.

#### Scenario: A live worker editing a file

- **WHEN** a worker is live on a ticket and its activity line reads as editing a file
- **THEN** the card shows that line with a working indicator and the time since it began

#### Scenario: The relative time advances

- **WHEN** a card is showing an activity line and some seconds pass without a new event
- **THEN** the displayed time since the activity began increases

#### Scenario: A long label truncates

- **WHEN** an activity line is longer than the card's width
- **THEN** it is truncated with an ellipsis and the card keeps its bounded height

#### Scenario: No line is shown when none is known

- **WHEN** a live worker has no activity line
- **THEN** the card shows no activity line

#### Scenario: Waiting and merging keep their own state

- **WHEN** a ticket is waiting on a decision, merging or delivering
- **THEN** its card shows that state and not a tool-activity line

### Requirement: A card shows the latest test tally when one is known

When the daemon reports a test tally for a ticket's worker, the card SHALL show it as the passed count
over the total, toned so that a tally with no failures reads as good and a tally with failures reads
as a warning. When no tally is known, the card SHALL show nothing.

#### Scenario: A passing tally

- **WHEN** the worker's last test command reported every test passing
- **THEN** the card shows the passed/total tally in the good tone

#### Scenario: A failing tally

- **WHEN** the worker's last test command reported some tests failing
- **THEN** the card shows the passed/total tally in the warning tone

#### Scenario: Nothing when no tally

- **WHEN** no test tally has been parsed for the worker
- **THEN** the card shows no test tally

### Requirement: A card shows an open pull request's checks

When a ticket records an open pull request whose check rollup is non-empty, the card SHALL show the
pull request's number and state and the passed count over the total checks, for example
`#326 open · Checks 5/6`. When the ticket records no pull request, or its rollup is empty, the card
SHALL show nothing for the pull-request checks.

#### Scenario: An open pull request with checks

- **WHEN** a ticket records an open pull request whose rollup has passing and total checks
- **THEN** the card shows its number, its state and the passed/total checks

#### Scenario: A pull request with no checks

- **WHEN** a ticket records an open pull request with an empty check rollup
- **THEN** the card shows nothing for the pull-request checks

#### Scenario: No pull request

- **WHEN** a ticket records no pull request
- **THEN** the card shows nothing for the pull-request checks

### Requirement: The board stays current and cheap

The board SHALL keep the activity lines, test tallies and pull-request checks current from the
workspace event stream it already consumes and the workers read it already performs. It SHALL NOT open
a run-event stream per card, and it SHALL coalesce incoming activity updates so a busy worker does not
re-render the board many times a second.

#### Scenario: No per-card stream is opened

- **WHEN** the board shows many working cards
- **THEN** no run-event stream is opened for any card

#### Scenario: A pushed update redraws only what changed

- **WHEN** one worker's activity line changes while the board is open
- **THEN** that worker's card reflects the new line without a reload

#### Scenario: Checks change while the pull request stays open

- **WHEN** an open pull request's checks change while the board is open
- **THEN** its card shows the new passed/total tally without a reload
