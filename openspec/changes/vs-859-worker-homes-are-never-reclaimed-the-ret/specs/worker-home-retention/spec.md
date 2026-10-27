# worker-home-retention Specification

## Purpose
Keep `workers/` bounded as a workspace runs: a finished worker's home and checkout are reclaimed once
its work has provably landed and it is past the retention window, and a home that holds anything not
provably landed is left alone and reported instead.

## ADDED Requirements

### Requirement: The retention pass reclaims finished worker homes

The existing daily retention pass SHALL also consider directories under `paths.workers`. It SHALL
reclaim a home only for an agent of kind `worker` or `planner` whose status is `retired` or `done`,
and only when the retention window has passed — measured from `retired_at` when set, otherwise from
the agent's own last turn or completion time. It SHALL NOT use a directory's mtime and SHALL NOT
consider an `active`, `running`, `paused`, `provisioning` or `error` agent regardless of age.

A directory with no matching agent row SHALL be left in place and reported; it SHALL NOT be deleted.

#### Scenario: A finished worker past the window is reclaimed

- **WHEN** a worker is `retired` or `done`, its retention time is older than `workerArchiveDays`, and its worktree is clean and landed
- **THEN** its worktree is removed and its home directory under `workers/` is deleted

#### Scenario: A worker inside the window is kept

- **WHEN** a finished worker's retention time is newer than `workerArchiveDays`
- **THEN** its home and worktree are untouched

#### Scenario: An active or running worker is never touched

- **WHEN** a worker is `active` or `running`, however old its directory looks
- **THEN** the sweep does not read, remove or delete anything in its home

#### Scenario: The cutoff is the agent's own completion time, not the directory's age

- **WHEN** a `done` worker's directory has an old mtime but its last turn is inside the window
- **THEN** it is kept, and a `done` worker whose directory mtime is fresh but whose last turn is past the window is reclaimed

#### Scenario: A directory without an agent row is reported and kept

- **WHEN** a directory exists under `workers/` whose name matches no agent
- **THEN** the sweep leaves it untouched and records a finding naming the directory

### Requirement: Nothing unprovably landed is deleted

The sweep SHALL remove a worktree only when:
- `git status --porcelain --untracked-files=all` in it prints nothing (no tracked change and no
  untracked file), and
- its work is proven landed, either by `landedWorkTest` reporting landed, or by the worker's ticket
  holding a pull-request work product whose state is `merged`.

When any condition fails — a dirty or untracked-holding worktree, no landed proof, an unreadable
worktree, or an undeterminable branch — the sweep SHALL skip that worker, SHALL leave its home and
worktree exactly as they were, and SHALL continue with the rest of the candidates.

Git ancestry alone is not sufficient here: a squash merge, a pruned merged branch, or a rewritten
history leaves a landed branch looking unlanded, so the merged pull-request record is the durable
proof.

#### Scenario: Uncommitted tracked changes block the removal

- **WHEN** a finished worker's worktree has any modified or staged file
- **THEN** nothing in its home is removed and a finding names the uncommitted file count

#### Scenario: Untracked files block the removal

- **WHEN** a finished worker's worktree has no modified files but does have untracked files
- **THEN** nothing in its home is removed and a finding names the untracked file count

#### Scenario: A merged pull request proves the landing

- **WHEN** a finished worker's worktree is clean and its ticket has a `merged` pull-request work product, but its branch is no longer on any remote
- **THEN** the worktree and home are reclaimed

#### Scenario: No landed proof

- **WHEN** a finished worker's worktree is clean but its ticket has no merged pull-request work product and `landedWorkTest` does not report landed
- **THEN** nothing in its home is removed and a finding names the reason

#### Scenario: A refusal does not stop the sweep

- **WHEN** one candidate is refused and another candidate is reclaimable
- **THEN** the reclaimable one is removed in the same pass and the refused one is reported

#### Scenario: An unreadable worktree is refused

- **WHEN** the sweep cannot read a worktree's status
- **THEN** that worker is skipped and reported, and no part of its home is deleted

### Requirement: A worktree is removed through the provider and its branch is kept

The sweep SHALL remove a worktree through the project's registered worktree provider with
`deleteBranch: false`, so the project's `.git/worktrees/<name>` metadata is removed and
`git worktree list` no longer names the tree, while the branch and its commits remain in the project
clone. It SHALL delete the home directory only after the provider removal succeeds.

If the provider removal fails, the sweep SHALL leave the home in place, record the failure, and keep
sweeping. A home left behind after a successful worktree removal SHALL be removed by the next pass
(a home without a `work/` directory has nothing to protect).

#### Scenario: The project metadata is left consistent

- **WHEN** a finished worker's worktree is reclaimed
- **THEN** `git worktree list` in the project clone no longer names it and its branch still resolves

#### Scenario: A failed provider removal deletes nothing

- **WHEN** the provider refuses or fails to remove the worktree
- **THEN** the home directory still exists and a finding names the failure

#### Scenario: A half-removed home is finished next pass

- **WHEN** the worktree is gone but the home directory could not be deleted
- **THEN** the next pass deletes the remaining home without needing a worktree removal

### Requirement: Skips and reclaims are reported

Each refusal SHALL produce a finding that names the worker (or directory), its status and what it
holds, written to the log and to an activity row, and returned in the pass's result. Each successful
reclaim SHALL be recorded to the activity log. The sweep SHALL NOT post a ticket comment per skip.

#### Scenario: The first pass report lists every refusal with a reason

- **WHEN** the sweep runs over a workspace with refused candidates
- **THEN** its result lists each refused worker with a reason and what it holds, and no ticket comment is posted for it

#### Scenario: A reclaim is auditable

- **WHEN** a worker's home is reclaimed
- **THEN** an activity entry records it for that worker

### Requirement: The operator can run the same pass on demand

`weave worker prune-homes [--dry-run]` SHALL run the same selection, safety checks and removal the
retention pass uses. With `--dry-run` it SHALL list candidates and refusals and delete nothing;
without it, it SHALL reclaim them and report what it did.

#### Scenario: Dry run deletes nothing

- **WHEN** the command runs with `--dry-run`
- **THEN** it lists the candidates and refusals and no worktree or home is removed

#### Scenario: The real run reclaims and reports

- **WHEN** the command runs without `--dry-run`
- **THEN** each candidate is reclaimed and the output lists what was reclaimed and what was skipped and why

### Requirement: The existing archive sweep is unchanged

The run-log and `archive/` pruning SHALL keep their current behaviour and retention configuration, and
SHALL still run in the same pass.

#### Scenario: Archive pruning still happens

- **WHEN** a worker archive is older than `workerArchiveDays`
- **THEN** it is deleted exactly as before, whether or not any home was reclaimed
