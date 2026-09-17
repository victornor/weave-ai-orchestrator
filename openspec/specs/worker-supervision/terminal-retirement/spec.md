# worker-supervision/terminal-retirement Specification

## Purpose
Takes a worker out of the live set the moment its ticket reaches `done` or `cancelled`, so Live
cannot keep showing a leftover “waiting for the next turn” cell on a finished ticket.

## Requirements

### Requirement: A terminal ticket takes its worker out of the live set

When a ticket reaches `done` or `cancelled`, every worker still bound to that ticket SHALL leave
live statuses (`provisioning`, `active`, `running`) in that same transition, not on a later
supervisor pass. Wakes queued for that worker SHALL be cancelled so it does not take another turn.

If the transition is performed by the worker's currently executing run, that run SHALL be allowed to
return its runtime result and final report. The daemon SHALL NOT interrupt or retire that current run
before finalization. The worker SHALL remain out of the live set while its run finalizes, and SHALL be
retired when its worktree can be removed (work has landed, or there is no worktree). A run owned by a
different actor that is still active when the ticket becomes terminal SHALL be interrupted as before.
When the worktree is unlanded, the worker SHALL be `done` and the worktree SHALL stay until the work
lands or is discarded, matching a human cancelling that worker.

A worker that is already `retired` or `done` SHALL be left as it is. A ticket with no worker SHALL
not fail the transition.

#### Scenario: Completing a ticket takes its worker out of the live set

- **WHEN** a ticket with a live worker reaches `done`
- **THEN** that worker's status is not `provisioning`, `active`, or `running`

#### Scenario: Cancelling a ticket takes its worker out of the live set

- **WHEN** a ticket with a live worker reaches `cancelled`
- **THEN** that worker's status is not `provisioning`, `active`, or `running`

#### Scenario: An unlanded worktree is kept

- **WHEN** a ticket reaches `cancelled` and its worker's worktree has not landed
- **THEN** the worktree is still present and marked dirty, and the worker is not live

#### Scenario: An already-retired worker is left alone

- **WHEN** a ticket reaches `done` and its worker is already `retired`
- **THEN** that worker stays `retired`

#### Scenario: A worker can finish the run that closed its ticket

- **WHEN** a worker's active run transitions its own ticket to `done` and then returns a valid final report
- **THEN** the run is recorded as succeeded with its report and summary, the ticket remains `done`, and the worker is not recorded as interrupted

#### Scenario: An external terminal transition still interrupts another active run

- **WHEN** a different actor transitions a ticket to `cancelled` while its worker has an active run
- **THEN** that active run is interrupted and the worker remains out of the live set

### Requirement: Untracked leftovers do not block retirement once the work has landed

The landed-work test SHALL distinguish untracked files (`??` in `git status --porcelain`) from
modified or staged tracked files. Untracked files alone SHALL NOT make a worktree "not landed":
when every commit on the ticket branch is contained in the ticket's effective landing branch (or
the pull request is merged and the branch's content matches it), the worktree SHALL be treated as
landed even though untracked files are present. Modified or staged tracked files SHALL continue to
make it not landed, and commits not contained in the landing branch SHALL continue to make it not
landed, exactly as before.

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

- **WHEN** a worker's branch has a commit that its landing branch does not contain
- **THEN** the worker is not retired, irrespective of untracked files

### Requirement: A terminal ticket's stale pull-request record is refreshed from the forge

When a ticket is `done` or `cancelled` and its `pull_request` work product is recorded in a
non-merged state, the daemon SHALL query the forge for that pull request's current state before
deciding whether the worker's work landed, and SHALL record a merged answer on the work product so
later decisions and the UI see it. A merged answer SHALL feed the existing containment check, so a
squash-merged or rebase-merged branch whose commits are not ancestors passes on patch equivalence.

A forge that cannot be reached, or a pull request the forge cannot resolve, SHALL leave the stored
record unchanged and the decision SHALL fall back to the stored evidence — a retirement is never
refused or granted on an unreadable forge alone.

The supervisor retries retirement on every tick, so the daemon SHALL refresh a given terminal
ticket's pull request at most once per worker per period (one hour), recording when it last checked
and using the stored record in between, so a genuinely open pull request does not cost a forge
query every tick.

#### Scenario: A squash-merged PR with a stale open record retires

- **WHEN** a terminal ticket's pull request was squash-merged on the forge, its stored work product
  still says `open`, and its branch's commits are patch-equivalent to the landing branch
- **THEN** the daemon records the pull request as merged and retires the worker

#### Scenario: An open PR does not retire an unlanded worker

- **WHEN** a terminal ticket's pull request is still open on the forge and its branch's commits are
  not contained in the landing branch
- **THEN** the worker is not retired

#### Scenario: An unreachable forge does not decide either way

- **WHEN** the forge cannot be reached while deciding a terminal worker's retirement
- **THEN** the stored record is unchanged and the decision uses the evidence already recorded

#### Scenario: Repeated retirement attempts do not hammer the forge

- **WHEN** two retirement attempts for the same terminal worker happen within the refresh period and
  the pull request is still open
- **THEN** the forge is queried once and the second attempt uses the stored record

### Requirement: A kept worker records why it was kept

When a terminal ticket's worker cannot be retired, the daemon SHALL record on the worker the reason
its work has not landed, so the Roles page can show why it is being kept. The worker SHALL remain
`done` and its worktree SHALL remain until the work lands or a human discards it. A cancelled
ticket's worker whose commits or untracked material never landed SHALL be kept and surfaced this
way, not silently discarded.

#### Scenario: The reason is recorded

- **WHEN** retirement of a terminal ticket's worker is refused
- **THEN** the worker carries the reason its work has not landed

#### Scenario: A cancelled ticket's unlanded work is surfaced

- **WHEN** a cancelled ticket's worker has commits or untracked material not contained in its
  landing branch
- **THEN** the worker is kept and its recorded reason is available to the page that lists it
