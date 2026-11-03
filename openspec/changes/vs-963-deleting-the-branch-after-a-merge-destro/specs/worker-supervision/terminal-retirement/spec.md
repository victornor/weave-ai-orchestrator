## MODIFIED Requirements

### Requirement: Untracked leftovers do not block retirement once the work has landed

The landed-work test SHALL distinguish untracked files (`??` in `git status --porcelain`) from
modified or staged tracked files. Untracked files alone SHALL NOT make a worktree "not landed":
when every commit on the ticket branch is contained in the ticket's effective landing branch, the
pull request is merged and the branch's content matches it, or the ticket's recorded merge proves the
checkout (`worker-landing-proof`), the worktree SHALL be treated as landed even though untracked files
are present. Modified or staged tracked files SHALL continue to make it not landed, and commits that
are neither contained in the landing branch nor covered by the ticket's recorded merge SHALL continue
to make it not landed.

Before a worktree carrying untracked files is removed, the daemon SHALL copy those files into the
worker's archive directory under `untracked/`, preserving their relative paths, so that nothing
untracked is deleted without being kept. Only then may the worktree be removed with the force a
dirty worktree needs. The worker archive is pruned after the configured retention period, so the
daemon SHALL also record a trail naming what it archived: a system comment on the worker's ticket
listing the relative paths (capped, with the remainder as a count), and the same list on the
`worker.retire` activity record, so a human can rescue a real file before it ages out.

#### Scenario: Untracked-only leftovers on landed work retire

- **WHEN** a worker's branch has landed, its worktree contains only untracked files such as review
  screenshots or a scratch directory, and the worker is retired
- **THEN** the worker is retired and the worktree is removed

#### Scenario: The untracked files are kept in the archive

- **WHEN** a worktree with untracked files at relative paths is retired
- **THEN** every one of those files is present under the worker's archive directory at
  `untracked/<relative path>`

#### Scenario: The archived files are recorded for rescue

- **WHEN** a retirement archives untracked files
- **THEN** the worker's ticket carries a system comment listing their relative paths and the
  `worker.retire` activity record names the same files, so a human can recover one before the
  archive is pruned

#### Scenario: A modified tracked file still blocks retirement

- **WHEN** a worker's branch has landed but its worktree has a modified or staged tracked file
- **THEN** the worker is not retired and its worktree is kept

#### Scenario: An unlanded commit still blocks retirement

- **WHEN** a worker's branch has a commit that its landing branch does not contain and that the
  ticket's recorded merge does not cover
- **THEN** the worker is not retired, irrespective of untracked files

#### Scenario: A squash-merged multi-commit branch retires at merge

- **WHEN** a ticket reaches `done` through `mergeDone`, its pull request squash-merged a branch of
  several commits, and the worker's checkout HEAD is the recorded pull-request head
- **THEN** the worker is retired and its worktree is removed, although `git cherry` finds no
  equivalent patch for the branch's individual commits
