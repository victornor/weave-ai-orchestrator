## ADDED Requirements

### Requirement: The active merge's worker is woken when its pull request's checks resolve

While a ticket is in a project's active merge step — admitted, `merge_started_at` set — and carries a
pull request, the daemon SHALL observe that pull request's state on its own supervisor cadence,
independently of the slower reconciliation pass. It SHALL wake the ticket's live worker when the
checks transition to a resolved state — passing or failing — or when the pull request's merge state
becomes clean. It SHALL NOT wake the worker for a `blocked` merge state while the checks are still
pending, since a forge reports blocked while required checks run, and SHALL NOT treat a draft pull
request with no checks as resolved. The wake SHALL carry the outcome and SHALL be enqueued exactly
once per transition, keyed stably by the ticket, the pull request's head, and the resolved state, so
that a later observation with no change wakes nobody and a repeated pass cannot stack a second turn.
A transition to passing SHALL tell the worker the checks are green and it may request landing; a
transition to failing SHALL tell it the checks failed. The worker SHALL NOT have to poll its own
checks to make progress.

The daemon SHALL poll only tickets in the active merge step, never a ticket still waiting in the
queue, and SHALL bound how often it calls the forge for one ticket so that a deep queue does not
multiply forge calls.

#### Scenario: Checks pass and the worker is woken once

- **WHEN** a merging ticket's pull request checks move from pending to passing
- **THEN** the ticket's live worker is woken once, carrying that the checks passed

#### Scenario: A pass with no state change wakes nobody

- **WHEN** the supervisor observes the same pull request state again with no change
- **THEN** no further wake is enqueued for that ticket

#### Scenario: Checks fail and the worker is woken with the failure

- **WHEN** a merging ticket's pull request checks move from pending to failing
- **THEN** the ticket's live worker is woken once, carrying that the checks failed

#### Scenario: A new head re-arms the transition

- **WHEN** the worker pushes a new head for the same pull request and its checks later resolve
- **THEN** the worker is woken again for that head's resolution, because the transition is keyed to
  the head as well as the state

#### Scenario: A clean merge state wakes the worker

- **WHEN** the forge reports a merging ticket's pull request merge state becoming clean, with its
  checks resolved or absent
- **THEN** the ticket's live worker is woken once with that merge state

#### Scenario: Blocked while checks are pending does not wake

- **WHEN** the forge reports a merging ticket's pull request merge state as blocked while its checks
  are still pending
- **THEN** the ticket's live worker is not woken for the merge state

#### Scenario: A queued merging ticket is not polled

- **WHEN** a ticket is in the merging status but has not been admitted to the active merge step
- **THEN** the daemon does not poll its pull request and does not wake its worker

#### Scenario: A draft pull request does not read as resolved

- **WHEN** a merging ticket's pull request is a draft with no checks
- **THEN** the daemon does not treat it as resolved and does not wake the worker

### Requirement: The merge queue shows what the active merge is waiting on

For a ticket in a project's active merge step, the merge queue SHALL report which of the two the
merge is currently waiting on — CI, while its pull request's checks have not resolved, or the worker,
while the checks have resolved (or there are none) and the worker has not acted since — together with
how long it has been in that state, in addition to how long it has been in the active step. The web
application's merge queue view SHALL show that wait for each active merge, and the board's merge queue
line SHALL show it for the ticket that has been in the active step longest, so an idle slot is
visible as waiting on CI or on the worker rather than as a single unexplained duration.

#### Scenario: An active merge waiting on CI says so

- **WHEN** a project's active merge has checks still pending and the queue is read
- **THEN** the active entry reports that it is waiting on CI and for how long its checks have been
  pending

#### Scenario: An active merge waiting on its worker says so

- **WHEN** a project's active merge has resolved checks and its worker has not acted since and the
  queue is read
- **THEN** the active entry reports that it is waiting on the worker and for how long

#### Scenario: The web view and the board line show the wait

- **WHEN** the merge queue view is opened, or the board is shown, while a ticket is in the active
  merge step
- **THEN** the wait is shown against that ticket, saying whether it is waiting on CI or on the worker
