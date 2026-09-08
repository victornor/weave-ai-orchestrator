# run-recovery/paused-worker-visibility Specification

## Purpose
Defines what a worker records about why it stopped, where a human can see that reason, and how a
worker that is waiting on a human is resumed — so that stopped work is legible on every surface and
one action puts it back to work on the same ticket.

## Requirements

### Requirement: A paused worker records why it stopped

When the system pauses a worker after a failure, it SHALL record, against that worker, the family of
the failure, the runtime's own error code, the runtime's own message, and the time the limit resets
when the runtime reported one. The families SHALL be the ones the system already classifies failures
into, including quota, upstream, tooling and unknown.

The recorded reason SHALL survive until the worker takes another turn or is resumed, and SHALL be
readable through the same read that returns the worker.

A worker paused for a reason other than a failure — a human pausing it, for instance — SHALL record
that reason and no failure family.

#### Scenario: A quota failure is recorded

- **WHEN** a worker is paused because its runtime reported a usage limit that says when it resets
- **THEN** the worker records the quota family, the runtime's code, the runtime's message and the
  reset time

#### Scenario: The reason is readable

- **WHEN** a client reads a paused worker
- **THEN** the answer carries the failure family and the runtime's message

#### Scenario: A human pause carries no family

- **WHEN** a human pauses a worker with a reason
- **THEN** that reason is recorded and no failure family is

### Requirement: Every surface that shows a worker shows why it stopped

Wherever the system presents a paused worker to a human — the decision card, the worker's ticket,
the board, the list of workers, the worker's own page and the command line — it SHALL name the
failure family and the runtime's message, and the reset time when one is known.

A surface that shows the ticket rather than the worker SHALL name the same reason on the ticket, so
that a human looking at the work sees why it stopped without opening the worker. This SHALL hold
everywhere a ticket is shown next to its worker's liveness, including the board (both the kanban card
and the phone row), a project's work-in-progress list, and the conductor's own briefing digest — not
only the ticket's own detail page. A ticket surface SHALL NOT determine whether to show this by
whether its worker counts as "live" for other purposes such as column placement; a paused worker is,
by definition, not live, and a lookup that excludes it SHALL NOT be the one a paused-reason display
depends on.

#### Scenario: The board shows the reason

- **WHEN** a ticket whose worker is paused for a usage limit is shown on the board
- **THEN** the card says the work is paused and names the quota family and the runtime's message

#### Scenario: The board shows a login-outage reason too

- **WHEN** a ticket whose worker is paused because its runtime's login expired is shown on the
  board's kanban card or its phone row
- **THEN** the card names that reason, exactly as it would for a usage limit, even though the ticket's
  own status is unchanged and no other agent on the board is affected

#### Scenario: A project's work-in-progress list shows the reason

- **WHEN** a ticket whose worker is paused, for any recorded reason, is shown in a project's list of
  work under way
- **THEN** that entry names the reason, the same as the board would

#### Scenario: The conductor's digest names the reason

- **WHEN** the conductor's own briefing lists a ticket whose worker is paused
- **THEN** that ticket's line in the digest names the worker's status and its pause reason, not only
  the ticket's own status and its latest status comment

#### Scenario: The worker list shows the reason

- **WHEN** the workers are listed, on the web or on the command line, and one is paused after a
  failure
- **THEN** that worker's row names the family and the runtime's message

#### Scenario: A worker with no recorded reason

- **WHEN** a paused worker was paused before the reason was recorded, or was paused without one
- **THEN** the surfaces show it as paused with whatever free-text reason it carries, and show no
  empty or invented failure family

### Requirement: Resuming a paused worker puts it back to work

Resuming a paused worker SHALL clear its pause and SHALL cause it to take a turn, on the same
ticket, in the same worktree and on the same branch, continuing its existing session. Resuming SHALL
NOT create a second worker, SHALL NOT reset the ticket's progress and SHALL NOT discard the
worktree.

Resume SHALL be offered wherever a paused worker is shown: on the decision card raised for it, on
its ticket, in the list of workers, on the worker's own page and on the command line.

A worker stopped because its runtime's login expired SHALL be the one exception: while that runtime
still needs a login, resume SHALL NOT be offered for it, because a turn started then could only fail
again. Such a worker SHALL instead be shown as waiting on that login, and SHALL be resumed by the
system itself once the login is restored.

When a resumed worker's ticket is blocked only by that pause, resuming SHALL move the ticket back to
**exactly the status it held immediately before it was moved to `blocked`** — not a status inferred
from any other signal, such as whether a run happens to still hold the ticket's execution lock. A
ticket parked while `approved` or mid-implementation (`in_progress`, `in_review`, `merging`) SHALL
return to that same status, and SHALL NOT be moved to `todo`, `proposing` or `proposed`. In
particular, a `change` ticket already carrying an approved, unchanged plan SHALL NOT have a new
plan-approval decision raised for it as a result of being parked and resumed: it never re-enters
`proposing` or `proposed` for that reason. Work already implemented and committed on the ticket's
branch SHALL NOT be redone or re-planned because the ticket was parked. Only a ticket for which no
prior status is recorded — because it was blocked before the system could record one — SHALL fall
back to `todo`.

The conductor SHALL be told the worker resumed.

#### Scenario: Resume wakes the worker

- **WHEN** a human resumes a paused worker
- **THEN** the worker is no longer paused and a turn is queued for it
- **AND** it continues on the same ticket, worktree and branch

#### Scenario: Resume unblocks the ticket

- **WHEN** a paused worker whose ticket was blocked by the pause is resumed
- **THEN** the ticket returns to the status the work continues in
- **AND** the conductor is told the worker resumed

#### Scenario: An approved plan is not re-approved after a park and resume

- **WHEN** a `change` ticket is `approved` (or further along, `in_progress`, `in_review`, `merging`)
  with a plan the human has already approved, its worker is parked, and the worker is then resumed
- **THEN** the ticket returns to the exact status it held before it was blocked
- **AND** no plan-approval decision is raised, because the ticket does not pass through `proposing`
  or `proposed` to get there
- **AND** any tasks already implemented and committed on the ticket's branch are left as they are

#### Scenario: A parked task ticket resumes to the status it was working in

- **WHEN** a `task` ticket that is `in_progress` is parked and its worker is then resumed
- **THEN** the ticket returns to `in_progress`, not `todo`

#### Scenario: Resume is offered everywhere the worker is shown

- **WHEN** a paused worker is shown on its ticket, in the worker list, on its own page or on the
  command line
- **THEN** each of those offers resuming it

#### Scenario: A worker waiting on an expired login is not offered resume

- **WHEN** a worker stopped by its runtime's expired login is shown while that runtime still needs a
  login
- **THEN** resume is not offered for it, and it is shown as waiting on that login

### Requirement: Relaunching a paused worker resumes it

When a worker that is paused waiting on a human is relaunched, the system SHALL treat that as a
resume: the same session, ticket, worktree and branch continue, and the work already done is not
repeated from the start.

The conductor SHALL see a worker paused waiting on a human as work blocked on the human, named with
its failure family and the runtime's message, and SHALL NOT see it as a stalled worker to restart.

#### Scenario: The conductor relaunches a quota-paused worker

- **WHEN** the conductor relaunches a worker paused because its runtime reported a usage limit
- **THEN** the worker continues its existing session on the same ticket and worktree

#### Scenario: The conductor's view of a paused worker

- **WHEN** the conductor takes a turn while one of its workers is paused after a failure
- **THEN** its context names that worker as blocked on the human, with the failure family and the
  runtime's message
