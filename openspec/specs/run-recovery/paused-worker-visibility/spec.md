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
that a human looking at the work sees why it stopped without opening the worker.

#### Scenario: The board shows the reason

- **WHEN** a ticket whose worker is paused for a usage limit is shown on the board
- **THEN** the card says the work is paused and names the quota family and the runtime's message

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
the status the work continues in, and the conductor SHALL be told the worker resumed.

#### Scenario: Resume wakes the worker

- **WHEN** a human resumes a paused worker
- **THEN** the worker is no longer paused and a turn is queued for it
- **AND** it continues on the same ticket, worktree and branch

#### Scenario: Resume unblocks the ticket

- **WHEN** a paused worker whose ticket was blocked by the pause is resumed
- **THEN** the ticket returns to the status the work continues in
- **AND** the conductor is told the worker resumed

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
