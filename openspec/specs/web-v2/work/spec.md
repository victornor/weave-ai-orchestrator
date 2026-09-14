# web-v2/work Specification

## Purpose
The Work screen shows one workspace's tickets as an owner-named kanban board or a table, so a person
can see what is backlogged, proposed, moving, waiting on them, blocked and done, and steer it from
one place.

## Requirements

### Requirement: Work shows one workspace's tickets as a kanban board and a table

The Work screen at `/v2/w/$ws/work` SHALL render the workspace's tickets in two switchable views —
kanban and table — from the same loaded ticket set, so both views SHALL show the same tickets. The
screen SHALL offer a control to switch between the two views, and it SHALL default to kanban.

#### Scenario: Both views show the same tickets

- **WHEN** the same ticket set is loaded and the user switches from kanban to table
- **THEN** every ticket the kanban showed appears in the table, and every ticket the table showed
  appears in the kanban

#### Scenario: Switching views

- **WHEN** the user activates the table control on the kanban
- **THEN** the table renders and the kanban control is no longer active, and switching back renders
  the kanban again

#### Scenario: A real ticket appears

- **WHEN** a workspace's ticket query returns an open ticket
- **THEN** that ticket appears on the Work screen, in the column its status folds into

### Requirement: Tickets fold into six columns, and a ticket waiting on the human is Proposed

Work SHALL fold the ticket statuses into six columns whose names name the owner of the next move:
Backlog · Proposed · In progress · In review · Blocked · Done.

- `backlog` and `todo` SHALL land in **Backlog**.
- `proposing` and `proposed` SHALL land in **Proposed**.
- `approved` and `in_progress` SHALL land in **In progress**.
- `in_review` and `merging` SHALL land in **In review**.
- `blocked` SHALL land in **Blocked**.
- `done` and `cancelled` SHALL land in **Done**.

A ticket with an open decision for the human that the daemon will not auto-approve SHALL land in
**Proposed**, whatever its stored status and whether or not a worker is live on it. A decision the
daemon will grant automatically under the active policy SHALL NOT move its ticket to Proposed.

A ticket with a live worker (provisioning, active or running) whose folded column is not one the
human owns SHALL land in **In progress**, as V1's board does. A **Done** column SHALL be present by
default and SHALL hold recently finished tickets, governed by the same Finished control V1 offers
(recent, all, hidden), with `cancelled` tickets shown as finished rather than as a separate column.

#### Scenario: A status folds into its column

- **WHEN** a ticket's only distinguishing fact is its stored status
- **THEN** `todo` shows in Backlog, `proposed` in Proposed, `in_progress` in In progress,
  `in_review` in In review, `blocked` in Blocked, and `done` in Done

#### Scenario: A live worker moves a ticket to In progress

- **WHEN** a ticket is `approved` or `in_progress` and a worker is provisioned, active or running on
  it
- **THEN** the ticket shows in In progress

#### Scenario: An open decision shows in Proposed

- **WHEN** a ticket has an open decision owned by the human and the daemon will not auto-approve it
- **THEN** the ticket shows in Proposed, even if a worker is live on it or its stored status is
  `blocked`

#### Scenario: An auto-approved decision does not move its ticket

- **WHEN** a ticket has an open decision whose approval the daemon will grant automatically under the
  active policy
- **THEN** the ticket does not show in Proposed because of that decision

### Requirement: Empty columns are narrow and cards widen them

A column with no cards SHALL render narrow (about 108px), and a column holding at least one card
SHALL render wide enough to hold cards. An empty column SHALL be styled identically to the others —
no tint, no "Empty" label, no placeholder text.

#### Scenario: An empty column

- **WHEN** a column has no tickets
- **THEN** it renders as a narrow strip with its name and a zero count and no card content

#### Scenario: A populated column

- **WHEN** a column holds at least one card
- **THEN** it renders wide enough for its cards and narrow columns beside it stay narrow

### Requirement: Cards and column headers omit the status glyph

A kanban card SHALL NOT show a status glyph, and a kanban column header SHALL show the column name
and its count only, because the column already states the status. The status glyph SHALL remain on
table rows and on the phone list, which are not grouped by column.

#### Scenario: A card has no glyph

- **WHEN** a ticket is rendered as a kanban card
- **THEN** the card shows no status glyph

#### Scenario: A column header has no glyph

- **WHEN** a column header is rendered
- **THEN** it shows the column name and the card count and no status glyph

### Requirement: A card carries its project, tags, worker role and age

Every kanban card SHALL show the ticket's project tag at its top-right, in the project's own hue,
its kind and tier tags wrapped on their own line, and the worker role on its own bottom row under a
hairline with the age beside it, so a long role name is not truncated. The card SHALL open the
ticket when activated.

#### Scenario: A card's anatomy

- **WHEN** a card for a ticket with a project and an assigned worker renders
- **THEN** the project tag appears top-right in that project's hue, the kind and tier tags appear
  above the hairline, and the worker role and age appear below the hairline

#### Scenario: A card opens its ticket

- **WHEN** the user activates a card
- **THEN** the app navigates to that ticket's V2 ticket page

### Requirement: Work shows the merge queue strip and creates tickets

Work SHALL show a merge queue strip carrying how many tickets are landing and how many are waiting,
counted over the tickets the screen loaded, from the project merge queue data (`GET
/projects/:id/merge-queue`) and the loaded tickets. Work SHALL offer a **New ticket** control that
creates a ticket through the existing create endpoint and reflects it on the board.

#### Scenario: The merge strip states the queue

- **WHEN** the workspace has tickets in `merging`, some started and some waiting
- **THEN** the strip states how many are landing and how many are waiting, and those figures are
  consistent with the tickets on the board

#### Scenario: Creating a ticket

- **WHEN** the user creates a ticket from Work
- **THEN** a ticket is created through the existing endpoint and appears on the board

### Requirement: The table view groups rows under the same six columns

The table view SHALL group its rows under the same six columns the kanban uses, each group header
showing the status glyph, the name and the row count, and each row showing the status glyph. A table
row SHALL carry at least the ticket identifier, title, kind, priority and age. Activating a row SHALL
open that ticket's V2 ticket page.

#### Scenario: A table row's columns

- **WHEN** a ticket is rendered as a table row
- **THEN** the row shows its status glyph, identifier, title, kind, priority and age

#### Scenario: A table row opens its ticket

- **WHEN** the user activates a table row
- **THEN** the app navigates to that ticket's V2 ticket page

### Requirement: Work filters the loaded tickets and derives its counts from them

Work SHALL offer filters over the loaded tickets — project, role, kind and priority — and SHALL
apply them to both the kanban and the table so the two views stay the same set. The counts shown on
the screen SHALL be derived from the tickets actually rendered, not from a literal.

#### Scenario: A filter narrows both views

- **WHEN** the user filters by a project
- **THEN** the kanban and the table both show only that project's tickets

#### Scenario: Counts match what is rendered

- **WHEN** a column header shows a count
- **THEN** that count equals the number of cards rendered in that column

### Requirement: Work is a list on phone

At phone width Work SHALL render the tickets as a list rather than a kanban or table, and each list
row SHALL carry the status glyph.

#### Scenario: The phone list

- **WHEN** Work renders at phone width
- **THEN** tickets appear as a list with a status glyph on each row, not as columns or a table

### Requirement: A ticket with a live worker shows the working mark and its live activity line

Work SHALL show, on a ticket whose worker is live (provisioning, active or running), the amber
working mark and that worker's current activity line — the running command, the test in progress or
the last tool call — together with its most recent test tally when the daemon has parsed one. The
line and tally SHALL update from the workspace event stream as new activity arrives, without a
reload. When the worker is live but has no current activity (between turns), Work SHALL show that
worker's last reported run summary as the ticket's line. A ticket with no live worker SHALL show no
working mark and no activity line. A ticket whose worker is paused SHALL show that paused state with
its reason instead of a working mark or activity line.

The same behaviour SHALL appear in the kanban cards, the table rows and the phone list, and SHALL be
derived from the workers read, the runs the screen has loaded and the workspace event stream — never
from a new endpoint.

#### Scenario: A live worker shows its working mark, line and tally

- **WHEN** a ticket has a running worker whose current activity is "Running tests" and whose most
  recent test tally is known
- **THEN** that ticket's card, table row and phone list row each show the working mark, the
  "Running tests" line and the test tally

#### Scenario: The line updates from the event stream

- **WHEN** a worker.activity frame arrives for a worker already shown on the screen
- **THEN** that worker's ticket shows the new activity line and test tally without a reload

#### Scenario: Between turns the last run line is shown

- **WHEN** a ticket's worker is live but has no current activity, and the worker's most recent run
  reported a summary
- **THEN** the ticket shows that run summary as its line, without the working mark's elapsed clock

#### Scenario: An idle ticket shows no working mark

- **WHEN** a ticket has no live worker
- **THEN** its card, table row and phone list row show no working mark and no activity line

#### Scenario: A paused worker shows its state, not a working mark

- **WHEN** a ticket's worker is paused with a reason
- **THEN** the ticket shows the paused state and its reason and shows no working mark or activity line
