## MODIFIED Requirements

### Requirement: The daemon reports every retained worker copy with its size and reason

A *retained copy* is a directory under a workspace's `workers/` that still holds a checkout (`work/`) and whose worker is not live (not `active`, `running`, `paused` or `provisioning`), or that has no agent row. A finished worker's clean checkout whose work is proven landed — including by its ticket's recorded merge (`worker-landing-proof`), whether or not its branch still exists — is not a retained copy. For each workspace the daemon SHALL produce a report of its retained copies with, per copy: the directory, the worker id and name, the ticket identifier and status, the project, the branch, the age measured from the ticket's terminal time (or from the worker's finish time when there is no ticket), the size on disk, and every reason it was not retired:

- `uncommitted`: the number of modified or staged tracked files and the number of untracked files;
- `commits_not_on_landing_branch`: the number of commits on the branch not contained in the landing branch, and how many of them are on no remote; for a ticket with a recorded merge, the number of commits made after that merge;
- `branch_gone`: the recorded branch does not exist in the project clone and no recorded merge proves the copy;
- `landing_unverified`: the ticket records a merge that the copy could not be checked against, with what was missing or which paths differ;
- `unreadable`: the checkout's state could not be read, with the error.

The report SHALL carry per-workspace totals: the number of retained copies, their total size, and the totals per class. Sizes SHALL carry the time they were measured.

Measuring sizes and reading git state SHALL run off the supervisor's tick, one copy at a time, and SHALL NOT delay any other supervisor step; the report SHALL be served from the last completed scan, and a fresh scan SHALL be requestable. A scan SHALL run at least daily and SHALL NOT modify any copy.

The report SHALL be available as `GET /api/w/:ws/workers/retained` (and `POST …/retained/scan` to request a fresh one), as `weave worker retained [--json]`, and in the web app on a workspace storage view.

#### Scenario: A fixture with both kinds of unlanded work

- **WHEN** a workspace has one finished worker whose checkout has 2 modified files and 3 untracked files, and another whose branch has 4 commits not on the landing branch, 1 of them on no remote
- **THEN** the report lists both copies with their sizes, the first with `uncommitted` 2 tracked / 3 untracked, the second with `commits_not_on_landing_branch` 4 (1 on no remote), and the workspace total is 2 copies and the sum of their sizes

#### Scenario: A live worker is not a retained copy

- **WHEN** a worker is `running` or `active` on an open ticket
- **THEN** it does not appear in the retained-copy report

#### Scenario: A directory with no agent row

- **WHEN** a directory under `workers/` with a `work/` checkout matches no agent
- **THEN** it appears in the report as an orphan with its size, and nothing in it is changed

#### Scenario: The scan never changes a copy

- **WHEN** a scan runs over a workspace
- **THEN** no file, worktree, branch or agent row in it is created, modified or removed

#### Scenario: A squash-merged copy whose branch was deleted is not retained

- **WHEN** a `done` ticket's clean checkout has three commits, its remote branch was deleted after the merge, and its recorded squash merge commit contains its content
- **THEN** it does not appear in the retained-copy report

### Requirement: Each retained copy has a retention class

Each retained copy SHALL be given exactly one class:

- `open`: its ticket is not in a terminal status. An open copy is never offered for reclaim.
- `landing_unverified`: its ticket is `done` or `cancelled`, its delivery records a merge, and the copy could not be checked against that merge. It is shown apart from unlanded work so the report does not imply work is at risk that the ticket says shipped.
- `finished_unlanded`: its ticket is `done` or `cancelled`, it is not `landing_unverified`, and its branch exists in the project clone.
- `branch_gone`: its ticket is `done` or `cancelled`, it is not `landing_unverified`, and its recorded branch no longer exists in the project clone, so the clone holds nothing to recover; only the copy's own files remain.
- `orphan`: it has no agent row, or no ticket.

A copy SHALL be marked *offerable* when it is not `open` and its age is at least `defaults.retainedCopyOfferDays` (workspace configuration, default 30). The class and the offerable mark SHALL be shown in the report. Neither the class nor the age SHALL ever cause a removal by itself.

#### Scenario: Terminal months ago versus still open

- **WHEN** one copy's ticket was `cancelled` 60 days ago and another copy's ticket is `in_review`
- **THEN** the first is `finished_unlanded` and offerable, and the second is `open` and not offerable

#### Scenario: The branch is gone from the clone

- **WHEN** a copy's ticket is `done` with no recorded merge and its recorded branch is not found in the project clone
- **THEN** its class is `branch_gone`

#### Scenario: A recorded merge that cannot be checked

- **WHEN** a copy's ticket is `done`, its delivery records `merged: true`, and neither its recorded pull-request head nor its merge commit is in the project clone
- **THEN** its class is `landing_unverified`, its reasons include `landing_unverified`, and it is not counted as `finished_unlanded`
