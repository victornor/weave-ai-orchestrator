## MODIFIED Requirements

### Requirement: Nothing unprovably landed is deleted

The sweep SHALL remove a worktree only when:
- `git status --porcelain --untracked-files=all` in it prints nothing (no tracked change and no
  untracked file), and
- its work is proven landed, by the worker's ticket's recorded merge (`worker-landing-proof`), by
  `landedWorkTest` reporting landed, or by the worker's ticket holding a pull-request work product
  whose state is `merged`.

When any condition fails — a dirty or untracked-holding worktree, no landed proof, a recorded merge
that is `landing_unverified`, an unreadable worktree, or an undeterminable branch with no proof from
the checkout's HEAD — the sweep SHALL skip that worker, SHALL leave its home and worktree exactly as
they were, and SHALL continue with the rest of the candidates.

Git ancestry alone is not sufficient here: a squash merge, a pruned merged branch, or a rewritten
history leaves a landed branch looking unlanded, so the ticket's merge record is the durable
proof.

A proven copy whose recorded branch no longer exists in the project clone SHALL be removed by its
path, still without force, and without deleting any branch.

#### Scenario: Uncommitted tracked changes block the removal

- **WHEN** a finished worker's worktree has any modified or staged file
- **THEN** nothing in its home is removed and a finding names the uncommitted file count

#### Scenario: Untracked files block the removal

- **WHEN** a finished worker's worktree has no modified files but does have untracked files
- **THEN** nothing in its home is removed and a finding names the untracked file count

#### Scenario: A merged pull request proves the landing

- **WHEN** a finished worker's worktree is clean and its ticket has a `merged` pull-request work product, but its branch is no longer on any remote
- **THEN** the worktree and home are reclaimed

#### Scenario: A recorded merge proves the landing after the branch was deleted

- **WHEN** a finished worker's worktree is clean, its ticket's delivery records a merge whose pull-request head is the checkout's HEAD, its pull-request work product still reads `open`, and its branch was deleted from the remote
- **THEN** the worktree and home are reclaimed

#### Scenario: A proven copy whose branch is gone from the clone

- **WHEN** a finished worker's clean checkout is on a detached HEAD, its recorded branch is not in the project clone, and its ticket's recorded merge commit contains its content
- **THEN** the checkout is removed by path, no branch is deleted, and the home is reclaimed

#### Scenario: No landed proof

- **WHEN** a finished worker's worktree is clean but its ticket records no merge, has no merged pull-request work product, and `landedWorkTest` does not report landed
- **THEN** nothing in its home is removed and a finding names the reason

#### Scenario: A refusal does not stop the sweep

- **WHEN** one candidate is refused and another candidate is reclaimable
- **THEN** the reclaimable one is removed in the same pass and the refused one is reported

#### Scenario: An unreadable worktree is refused

- **WHEN** the sweep cannot read a worktree's status
- **THEN** that worker is skipped and reported, and no part of its home is deleted
