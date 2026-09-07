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
