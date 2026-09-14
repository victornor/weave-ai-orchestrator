## ADDED Requirements

### Requirement: The ticket page shows the live working state and activity line

While the ticket's worker is live (provisioning, active or running), the ticket page SHALL show the
working state and that worker's current activity line — the running command, the test in progress or
the last tool call — near the top of the page, without the user opening a run or its transcript. The
line SHALL update from the workspace event stream as new activity arrives. When the worker is live
but has no current activity, the page SHALL show the worker's last reported run summary as the line.
A ticket with no live worker SHALL show neither the working state nor an activity line for a worker.
A ticket whose worker is paused SHALL show the paused state and its reason instead.

The line and state SHALL be derived from the same workers read, runs and workspace event stream the
V2 Work screen uses, so the two surfaces cannot disagree.

#### Scenario: A running worker shows on the ticket page

- **WHEN** a ticket's worker is running with the current activity "Editing src/Ticket.tsx"
- **THEN** the page shows the working state and that activity line near the top, with no run opened

#### Scenario: The ticket page line updates live

- **WHEN** a worker.activity frame arrives for the ticket's worker
- **THEN** the page's activity line updates without a reload

#### Scenario: The ticket page shows no line without a live worker

- **WHEN** the ticket has no live worker
- **THEN** the page shows no working state and no activity line for a worker

#### Scenario: The ticket page shows a live state the stored status would hide

- **WHEN** a ticket's stored status is not itself a working status but a worker is live on it
- **THEN** the page shows the working state, as V1's board does for a live worker
