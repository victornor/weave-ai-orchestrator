## ADDED Requirements

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
