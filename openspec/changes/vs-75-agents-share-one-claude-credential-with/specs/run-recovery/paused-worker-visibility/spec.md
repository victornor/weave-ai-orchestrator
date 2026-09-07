## MODIFIED Requirements

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
