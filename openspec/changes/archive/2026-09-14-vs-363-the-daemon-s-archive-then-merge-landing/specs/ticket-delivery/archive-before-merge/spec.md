## ADDED Requirements

### Requirement: Landing never requires a local checkout of the ticket's branch

The daemon SHALL perform its archive-then-merge sequence against the ticket's branch without creating,
checking out or resetting any local branch of that name. The scratch worktree SHALL remain detached at
`origin/<branch>`; the freshness check, the rebase, the archive and the archive commit SHALL run
against that detached `HEAD`, and the push SHALL target the remote branch by explicit refspec. The
sequence SHALL NOT modify any other worktree of the repository — in particular the requesting worker's
worktree, whose branch, `HEAD` and working tree SHALL be left exactly as they were. The ticket's branch
being checked out in another worktree SHALL NOT cause the landing to fail.

#### Scenario: The worker's worktree still holds the branch

- **WHEN** a worker requests landing for a ticket whose own worker worktree still has the ticket's
  branch checked out
- **THEN** the archive is committed onto the remote branch and the merge proceeds, and the worker's
  worktree still has the same branch, the same `HEAD` and an unchanged working tree

#### Scenario: No local branch is created or reset

- **WHEN** the daemon lands a ticket
- **THEN** no local branch for the ticket's branch is created or reset in the primary clone or the
  scratch worktree, and disposing the scratch worktree leaves no stray local branch behind

#### Scenario: The scratch contract works for a branch no worktree holds

- **WHEN** a caller commits onto an existing branch that no worktree has checked out
- **THEN** the same detached-worktree contract commits and pushes to that branch
