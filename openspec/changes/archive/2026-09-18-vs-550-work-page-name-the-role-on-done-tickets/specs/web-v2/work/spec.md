## ADDED Requirements

### Requirement: A ticket's assignee label names its live worker, else the role that did it

Work SHALL label each ticket with the identity of a live worker (provisioning, active or running)
while one holds the ticket, and otherwise with the role named by the ticket's `assigneeRoleId`, so a
ticket whose worker has finished names the role that did it rather than `unassigned`. A ticket with no
live worker and no assigned role SHALL read `unassigned`. A ticket with a live worker SHALL keep that
worker's identity and SHALL NOT have it replaced by a role name. The same label SHALL appear on the
kanban card, the table row and the phone list row.

#### Scenario: A finished ticket names its role

- **WHEN** a ticket is `done`, no worker is live on it, and it has an `assigneeRoleId`
- **THEN** its card, table row and phone row name that role, not `unassigned`

#### Scenario: A ticket with no role still reads unassigned

- **WHEN** a ticket has no live worker and no assigned role
- **THEN** it reads `unassigned`

#### Scenario: A live worker is not replaced by its role

- **WHEN** a ticket is in progress with a live worker and an assigned role
- **THEN** it shows the live worker's identity, not the role name

### Requirement: Work marks a merging ticket as landing or waiting, with its queue position

A ticket whose status is `merging` SHALL be marked as actively landing when its `merge_started_at` is
set, and as waiting otherwise. This distinction SHALL be read from `merge_started_at` and SHALL NOT be
inferred from status alone. A waiting ticket SHALL show its 1-based position among its project's
waiting tickets, ordered by the shared merge-queue rule (priority, then join time, then number, with a
starved ticket first). A landing ticket SHALL instead show what it is waiting on — `on CI` while its
checks are pending, otherwise `on the worker` — with the elapsed time when the phase start is known.
The mark SHALL appear on the kanban card, the table row and the phone list row.

#### Scenario: The landing ticket is distinguished from the waiting ones

- **WHEN** several tickets of one project are `merging`, one with `merge_started_at` set and the rest
  without
- **THEN** the one with `merge_started_at` reads as landing and shows what it waits on, and each of
  the others reads as waiting and shows its queue position

#### Scenario: A waiting ticket shows its position in queue order

- **WHEN** two waiting tickets joined at different times, or with different priorities, according to
  the shared queue rule
- **THEN** each shows the 1-based position the queue rule gives it

#### Scenario: The wait phase comes from the delivery state

- **WHEN** a landing ticket's delivery records pending checks
- **THEN** it reads as waiting on CI; when the checks are not pending it reads as waiting on the worker

### Requirement: The merge summary reaches the tickets it counts

The merge queue strip's landing count, waiting count, active landing ticket and next waiting ticket
SHALL each be a link that opens the ticket or tickets it refers to, so no figure is a dead number.
The strip SHALL remain a single line that truncates rather than wrapping or overflowing at narrow
widths.

#### Scenario: The counts link to their tickets

- **WHEN** the strip reads that some tickets are landing and some are waiting
- **THEN** activating the landing figure opens the ticket that holds the slot and activating the
  waiting figure reaches the waiting tickets

#### Scenario: The named tickets are links

- **WHEN** the strip names the active landing ticket or the next waiting ticket
- **THEN** activating that name opens that ticket's page

### Requirement: Work marks a ticket's plan origin and how it was created

A ticket linked to a plan draft SHALL show, on its card, the name of the plan it came from. A ticket
whose draft was linked before its plan was submitted SHALL be visibly distinguished from one linked at
plan submission (`filed at submission`), and both SHALL show the plan's name. A ticket with no linked
draft SHALL show nothing extra. The plan name SHALL link to the surface where a plan is opened, and no
new plan viewer SHALL be introduced.

#### Scenario: A planner-dispatched ticket names its plan

- **WHEN** a ticket was created by dispatching a plan draft while the plan was still drafting
- **THEN** its card names the plan and marks it as dispatched while drafting

#### Scenario: A submission-time ticket is distinguishable from a dispatched one

- **WHEN** two tickets both came from the same submitted plan, one dispatched while drafting and one
  created at submission
- **THEN** their cards mark them differently while both name the plan

#### Scenario: An ordinary ticket shows nothing extra

- **WHEN** a ticket has no linked plan draft
- **THEN** its card shows no plan name and no plan mark
