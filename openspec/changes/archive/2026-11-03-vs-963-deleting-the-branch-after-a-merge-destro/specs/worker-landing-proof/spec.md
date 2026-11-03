## Purpose

Decide whether a finished worker copy's committed work has landed from what the ticket itself recorded when it merged, rather than only from branch refs that branch cleanup, pruning and history rewrites remove, so finished work is recognised as landed and genuinely unlanded work is never mistaken for it.

## ADDED Requirements

### Requirement: A ticket's recorded merge proves its copy landed

When a worker's ticket records a merge in its delivery (`merged: true`), the daemon SHALL decide whether the worker's checkout landed from that record and the checkout's own HEAD, before and independently of any branch, remote-tracking ref or ancestry comparison against the landing branch:

- when the recorded pull-request head is present in the project clone and the checkout's HEAD equals it or is an ancestor of it, the copy SHALL be landed;
- otherwise, when the recorded merge commit (or, without one, the recorded landed commit) is present in the project clone and the checkout's HEAD is an ancestor of it, or every path the checkout changed since it forked from the merge commit's first parent has identical content in the merge commit, the copy SHALL be landed. Paths under the ticket's own OpenSpec change directory and under `openspec/specs/` SHALL be left out of this comparison, because the daemon's archive rewrites them in the merged result.

The proof SHALL read the checkout's HEAD, so a copy whose branch no longer exists in the project clone or on any remote SHALL still be provable. The proof SHALL use only the daemon's database and the project clone's local objects, never the forge.

Uncommitted tracked changes SHALL continue to make a copy not landed before this proof is consulted, and each caller's existing rule for untracked files SHALL be unchanged.

#### Scenario: Branch deleted after a merged pull request

- **WHEN** a `done` ticket's delivery records `merged: true` and a pull-request head equal to the checkout's HEAD, and the branch has been deleted from the remote after the merge
- **THEN** the copy is landed

#### Scenario: A multi-commit squash merge

- **WHEN** a ticket's branch has three commits, the pull request was squash-merged into a single commit recorded as the delivery's merge commit, no pull-request head is recorded, and every file the branch changed has the same content in that merge commit
- **THEN** the copy is landed, although no single commit of the branch has an equivalent patch in the landing branch

#### Scenario: Landed on edge, not on main

- **WHEN** a ticket's effective landing branch is `edge`, its recorded merge commit is on `edge` and not on `main`, and the checkout's content is contained in it
- **THEN** the copy is landed

#### Scenario: The branch is gone from the clone and the remote

- **WHEN** a checkout is on a detached HEAD, its recorded branch exists neither in the project clone nor on the remote, and its ticket's recorded merge commit contains its content
- **THEN** the copy is landed

#### Scenario: The daemon's own OpenSpec archive does not count as a difference

- **WHEN** the merged result moved the ticket's OpenSpec change directory into the archive and updated `openspec/specs/`, and every other path the checkout changed is identical in the merge commit
- **THEN** the copy is landed

### Requirement: Commits made after the recorded merge are still unlanded

When the checkout's HEAD is not contained in the recorded pull-request head and the content comparison against the recorded merge commit finds a differing path, the copy SHALL NOT be landed. When the recorded pull-request head is present, the verdict SHALL report the number of commits HEAD has beyond it.

#### Scenario: A commit after the merge

- **WHEN** a ticket's recorded pull-request head is the checkout's HEAD's parent, and the checkout's last commit changed a file that the merge commit holds with different content
- **THEN** the copy is not landed and the verdict reports one commit made after the recorded merge

### Requirement: A recorded merge that cannot be checked is reported as unverified

When a ticket records a merge but neither the recorded pull-request head nor the recorded merge commit is present in the project clone, or the content comparison cannot attribute a difference, the verdict SHALL be `landing_unverified`, naming what was missing or which paths differ. It SHALL NOT be reported as commits not contained in the landing branch, and it SHALL NOT count as landed.

#### Scenario: The merge commit is not in the clone

- **WHEN** a `done` ticket records `merged: true` with a merge commit that the project clone does not hold and no pull-request head
- **THEN** the verdict is `landing_unverified` with a reason naming the missing merge commit, and the copy is not landed

### Requirement: Work with no recorded merge is judged as before

When a ticket records no merge, the daemon SHALL apply the existing git tests unchanged: reachability of every commit from a remote-tracking ref, and, with a merged pull request or local-branch delivery, containment in the effective landing branch by ancestry or patch equivalence. Work with commits on no remote and no merged pull request SHALL remain not landed.

#### Scenario: Genuinely unlanded work

- **WHEN** a `cancelled` ticket's delivery records no merge, it has no merged pull-request work product, and its branch has two commits on no remote
- **THEN** the copy is not landed, and it is not removed by the retention sweep or retirement
