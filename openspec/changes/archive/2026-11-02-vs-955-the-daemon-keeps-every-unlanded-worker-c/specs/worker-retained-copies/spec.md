## Purpose

Make the worker copies the daemon keeps because their work has not landed visible, aged and reclaimable only by captain: what is kept, how big it is, why it was not retired, and what a reclaim would free and lose, with every removal of unlanded work gated on captain's explicit approval.

## ADDED Requirements

### Requirement: The daemon reports every retained worker copy with its size and reason

A *retained copy* is a directory under a workspace's `workers/` that still holds a checkout (`work/`) and whose worker is not live (not `active`, `running`, `paused` or `provisioning`), or that has no agent row. For each workspace the daemon SHALL produce a report of its retained copies with, per copy: the directory, the worker id and name, the ticket identifier and status, the project, the branch, the age measured from the ticket's terminal time (or from the worker's finish time when there is no ticket), the size on disk, and every reason it was not retired:

- `uncommitted`: the number of modified or staged tracked files and the number of untracked files;
- `commits_not_on_landing_branch`: the number of commits on the branch not contained in the landing branch, and how many of them are on no remote;
- `branch_gone`: the recorded branch does not exist in the project clone;
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

### Requirement: Each retained copy has a retention class

Each retained copy SHALL be given exactly one class:

- `open`: its ticket is not in a terminal status. An open copy is never offered for reclaim.
- `finished_unlanded`: its ticket is `done` or `cancelled` and its branch exists in the project clone.
- `branch_gone`: its ticket is `done` or `cancelled` and its recorded branch no longer exists in the project clone, so the clone holds nothing to recover; only the copy's own files remain.
- `orphan`: it has no agent row, or no ticket.

A copy SHALL be marked *offerable* when it is not `open` and its age is at least `defaults.retainedCopyOfferDays` (workspace configuration, default 30). The class and the offerable mark SHALL be shown in the report. Neither the class nor the age SHALL ever cause a removal by itself.

#### Scenario: Terminal months ago versus still open

- **WHEN** one copy's ticket was `cancelled` 60 days ago and another copy's ticket is `in_review`
- **THEN** the first is `finished_unlanded` and offerable, and the second is `open` and not offerable

#### Scenario: The branch is gone from the clone

- **WHEN** a copy's ticket is `done` and its recorded branch is not found in the project clone
- **THEN** its class is `branch_gone`

### Requirement: A reclaim is offered with what it frees and what it loses, and only captain's approval takes it

Captain MAY request a reclaim of one retained copy or of a selected set, from the storage view or `weave worker reclaim`. The request SHALL NOT remove anything. It SHALL raise human-owned `discard_approval` cards, each stating the size it would free and exactly what would be lost: the uncommitted and untracked file counts, and any commits reachable only from the copy.

- A copy whose branch has any commit on no remote, or whose checkout holds commits reachable from no branch, remote or tag (or whose commits cannot be determined), SHALL get its own card. It SHALL NOT be included in a card that covers other copies.
- Copies with no such commits MAY share one card for the set, which lists every copy with its size and losses and the set's total.
- An `open` copy SHALL NOT be included in any card.

A reclaim SHALL keep the branch and its commits in the project clone and SHALL remove only the checkout and the home directory. It SHALL run only after its card is answered `approve` by a human; it SHALL NOT be answered by auto-approval, by the weaver, or by a relayed answer. Before removing a copy, the reclaim SHALL re-read it and SHALL refuse that copy, leaving it intact and saying why, when its worker became live or its head, branch, commit counts or file counts differ from what the card stated. A refusal for one copy SHALL NOT stop the rest of an approved set.

No timer, retention pass, threshold, disk warning or configuration SHALL remove a retained copy that holds unlanded work. The existing reclaim of provably landed, clean homes is unchanged.

#### Scenario: A reclaim request removes nothing by itself

- **WHEN** captain requests a reclaim of three copies
- **THEN** cards are raised and all three copies are still on disk, unchanged, until a card is approved

#### Scenario: A copy with unpushed commits gets its own card

- **WHEN** captain requests a reclaim of a set where one copy's branch has 2 commits on no remote and two copies hold only uncommitted files
- **THEN** the copy with unpushed commits gets its own card naming the 2 commits, and the other two share one card that lists both with their sizes and file counts

#### Scenario: Declining keeps everything

- **WHEN** captain answers a reclaim card `reject`
- **THEN** no copy it covers is changed

#### Scenario: Approval removes the checkout and keeps the branch

- **WHEN** captain approves a reclaim card for a copy
- **THEN** its checkout and home directory are removed, its branch still resolves in the project clone with the same commits, and an activity entry records the reclaim and the bytes freed

#### Scenario: A copy that changed since the card is refused

- **WHEN** a copy's worker was relaunched, or its head moved, after the card was raised and captain then approves the card
- **THEN** that copy is not removed, the refusal is reported, and the other copies on the same card are still reclaimed

#### Scenario: No automatic path removes unlanded work

- **WHEN** the retention pass, the scan or the low-disk check runs over copies that are offerable and hold unlanded work, and no card is approved
- **THEN** none of those copies is removed

#### Scenario: Auto-approval does not answer a reclaim card

- **WHEN** a reclaim card is open while the workspace's auto-approval mode is on
- **THEN** the card stays open for captain
