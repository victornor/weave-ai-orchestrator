# ticket-lifecycle/blocked-resume Specification

## Purpose
A ticket parked at `blocked` with a routable action path is returned to the work it was doing once
that path is resolved and its worker is working again, so the board and every status reader never
show blocked for a ticket that is being worked.

## Requirements

### Requirement: A resolved block is undone when a resolving wake starts the worker's turn

When a ticket is `blocked` and a wake that resolves its block starts its worker's turn, the system
SHALL move the ticket back to the status it held immediately before it was moved to `blocked`,
unless the ticket is still waiting on a `blockedBy` ticket that has not finished.

A resolving wake is one that deliberately puts the worker back on this ticket: a decision answered
on the ticket, a weaver message, a human message or comment, a live interrupt, a resume, or a
retry/relaunch the human asked for. A wake that is not resolving — a generic system wake, a
self-scheduled wake, a scheduled routine, or a retry the system booked for itself — SHALL NOT reopen
the ticket.

The restore SHALL go through the ticket transition path, so that the status event, the activity log,
the board and the weaver all see it. The transition's note SHALL state that the worker resumed after
the block was answered. The restore SHALL NOT raise or supersede a decision the target status already
has open, and SHALL NOT enqueue a wake that would start a second turn for a worker already starting
this one.

The target status SHALL be the status recorded on the ticket when it was blocked. When no such
status is recorded, the ticket SHALL fall back to the status the existing resume, retry and
blocker-resolution paths already fall back to. The restore SHALL be valid for every ticket kind.

A ticket still waiting on an unfinished `blockedBy` ticket SHALL remain `blocked`. A worker that is
still stuck SHALL be able to move its ticket back to `blocked` in its turn, and that re-block SHALL
not be undone until another resolving wake starts another turn.

#### Scenario: A block resolved by an answer is undone at the next turn

- **WHEN** a ticket is `blocked` with an `{owner, action}` path of status `in_progress`, the owner
  answers it, and the worker's turn starts from that answer's wake
- **THEN** the ticket is `in_progress` before the turn does any work
- **AND** its status event and activity row record the move out of `blocked`, noting the worker
  resumed after the block was answered

#### Scenario: The exact prior status is restored for every kind

- **WHEN** a `change` ticket blocked from `approved`, a `task` ticket blocked from `in_progress`, or
  a `scout`, `question` or `operational` ticket blocked from `in_progress` has a resolving wake start
  its worker's turn, with no unfinished blocker
- **THEN** each ticket returns to the exact status it held before it was blocked, and not to `todo`

#### Scenario: A non-resolving wake leaves the ticket blocked

- **WHEN** a worker's turn starts from a self-scheduled wake, a scheduled routine, a generic system
  wake, or a retry the system booked for itself, and the ticket is `blocked`
- **THEN** the ticket remains `blocked` and no status event is recorded for it

#### Scenario: A re-block is not undone without a resolving wake

- **WHEN** a worker whose block was resolved moves its ticket back to `blocked` during its turn
- **THEN** the ticket remains `blocked` after the turn, and is only moved again when another
  resolving wake starts another turn

#### Scenario: A restored status's pending card is left alone

- **WHEN** a ticket blocked from `in_review` is restored by a resolving wake while a merge-approval
  card is open, or a ticket blocked from `approved` is restored
- **THEN** the open merge-approval card is neither superseded nor re-raised and keeps its weaver
  review mark
- **AND** no `ticket_assigned` wake is queued for the worker already starting the turn

#### Scenario: A ticket still waiting on unfinished blockers stays blocked

- **WHEN** a ticket is `blocked` because a `blockedBy` ticket has not finished, and a resolving wake
  starts its worker's turn
- **THEN** the ticket remains `blocked`
