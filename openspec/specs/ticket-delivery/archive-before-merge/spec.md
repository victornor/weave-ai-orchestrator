# ticket-delivery/archive-before-merge Specification

## Purpose
Defines the atomic operation that lands a ticket: archiving its OpenSpec change onto its own branch
and merging that branch, as one project-serialized step triggered by the worker's request to land,
so a ticket's merge and its spec archive can never separate into two commits or leave one done
without the other.

## Requirements

### Requirement: Requesting landing triggers archive-then-merge, not a check on a completed merge

When a worker requests landing for a ticket that carries an OpenSpec change, the daemon SHALL, before
any merge happens: verify the ticket's branch is a fast-forward descendant of the current tip of its
effective landing branch, archive the change onto that branch, push the archived branch, and only then
perform the merge with the project's configured merge method. The worker SHALL NOT perform the merge
itself for such a ticket.

For a ticket that carries no OpenSpec change, requesting landing SHALL perform the merge directly,
with no archive step, exactly as if the ticket had an already-archived, empty change.

#### Scenario: A normal request archives and merges in order

- **WHEN** a worker requests landing for a ticket whose branch is a fast-forward descendant of its
  effective landing branch and whose OpenSpec change validates cleanly
- **THEN** the archive is committed onto the ticket's branch, that branch is pushed, the merge is
  performed, and the ticket reaches `done` only after the merge is verified to have landed
- **AND** the landing branch gains exactly one commit from the ticket

#### Scenario: A ticket with no OpenSpec change merges without archiving

- **WHEN** a worker requests landing for a ticket that carries no OpenSpec change
- **THEN** the merge is performed with no archive step attempted

### Requirement: A merely stale branch is updated by the daemon; only a real conflict is sent back to the worker

When the ticket's branch is not a fast-forward descendant of the current tip of its effective landing
branch — because another ticket landed since the worker last synced — the daemon SHALL attempt to
rebase the branch onto that current tip itself, in a scratch location, before archiving or pushing
anything. When that rebase applies cleanly, the daemon SHALL proceed with the now-current branch
without involving the worker. When the rebase produces a conflict the daemon cannot resolve, the daemon
SHALL reject the landing request without archiving or pushing anything, and SHALL say so in terms the
worker can act on: that its branch conflicts with the current landing branch and it must re-sync and
resolve the conflict itself.

#### Scenario: Another ticket landed but nothing conflicts

- **WHEN** a worker requests landing for a ticket whose branch was synced to a landing-branch tip that
  is no longer current, and rebasing it onto the current tip applies with no conflicts
- **THEN** the daemon rebases the branch itself and continues the sequence without a worker round-trip

#### Scenario: A real conflict is sent back to the worker

- **WHEN** a worker requests landing for a ticket whose branch, rebased onto the current landing-branch
  tip, produces a conflict
- **THEN** the request is rejected before any archive or push is attempted, the rejection says the
  branch conflicts and must be re-synced by the worker, and the ticket is not merged and does not reach
  `done`

### Requirement: An archive failure blocks the merge entirely

When archiving a ticket's OpenSpec change fails — a validation error, an undeclared capability
retirement, or any other refusal the `openspec` CLI reports — the daemon SHALL NOT push the archive
commit and SHALL NOT perform the merge. The ticket SHALL remain out of `done`, and the rejection SHALL
carry the same validator detail an equivalent failure carries during `proposed` gating, so the worker
can resolve it the same way it resolves a rebase conflict.

#### Scenario: Archiving fails because of a collision with another change

- **WHEN** a worker requests landing and archiving the ticket's change would drop a scenario another,
  already-landed change to the same requirement depends on
- **THEN** the landing request is rejected, naming the requirement and the dropped scenario, no commit
  is pushed to the ticket's branch, and the merge does not happen

#### Scenario: A resolvable failure can be retried

- **WHEN** a landing request is rejected for an archive failure the worker can fix by updating its own
  change
- **THEN** the worker may update its branch and request landing again, and a subsequent request that
  archives cleanly proceeds to merge

### Requirement: Required checks the archive push triggers are awaited without holding the project's lock

When pushing the rebased-and-archived branch causes the landing branch's required status checks to be
re-evaluated for that ticket's pull request, the daemon SHALL wait for them to resolve before merging,
and SHALL NOT hold the project's archive-then-merge lock while waiting. The wait SHALL be bounded: if
the checks do not resolve within a bounded number of attempts, the daemon SHALL treat it as a landing
failure and report it rather than waiting indefinitely.

Once the checks resolve, the daemon SHALL re-acquire the lock and re-run the freshness check before
merging, since the landing branch may have moved again while this ticket waited. A branch found stale
at that point SHALL be handled exactly as any other stale branch — rebased and re-archived if it
applies cleanly, sent back to the worker only on a real conflict — before checks are waited on again.

A required check that fails on the archived branch SHALL be treated as an archive failure: no merge
happens, and the rejection carries the check's own failure detail.

The full rebase-archive-push-wait cycle SHALL itself be bounded by a small fixed number of cycles, so
that a ticket that keeps losing the freshness race to other tickets landing first cannot loop
indefinitely. Exceeding that bound SHALL fail the landing request and report it, naming how many
cycles ran, on the same terms as any other unresolvable landing failure — never a silent, indefinite
retry.

#### Scenario: Checks are pending, then pass, then the ticket lands

- **WHEN** a worker requests landing, the daemon archives and pushes the branch, and the pull request's
  required checks are pending
- **THEN** the daemon releases the project's lock while checks are pending, other tickets in the same
  project may proceed to their own archive-then-merge sequence meanwhile, and once the checks pass the
  daemon re-acquires the lock, re-checks freshness, and merges

#### Scenario: Checks fail on the archived branch

- **WHEN** a pull request's required checks fail after the daemon pushes the archived branch
- **THEN** the landing request is rejected with the check's failure detail, no merge happens, and the
  ticket does not reach `done`

#### Scenario: Checks never resolve

- **WHEN** a pull request's required checks remain pending past the bounded number of attempts the
  daemon waits
- **THEN** the landing request is reported as failed rather than polled indefinitely, and the ticket
  does not reach `done`

#### Scenario: A ticket keeps losing the freshness race

- **WHEN** a ticket's checks resolve successfully but the freshness re-check fails, and this repeats
  until the bounded number of rebase-archive-push-wait cycles is exhausted
- **THEN** the landing request is reported as failed, naming how many cycles ran, rather than looping
  again, and the ticket does not reach `done`

### Requirement: Archive-then-merge is serialized per project regardless of merge concurrency

For a given project, the daemon SHALL perform at most one archive-then-merge sequence at a time for its
exclusive, local steps — the freshness check, any daemon-performed rebase, archiving, pushing, merging,
verifying and fast-forwarding — even when the project's merge concurrency setting allows more than one
ticket to be in the active merge step at once. A second ticket's exclusive steps SHALL NOT begin until
the first's have completed or failed and released the project; waiting on required checks (previous
requirement) does not hold this lock, so more than one ticket may be waiting on its own checks at once.

This SHALL hold for two tickets whose OpenSpec changes touch the same capability: the second archives
against the spec state the first's archive already produced, whether that means waiting for the first
to finish its exclusive steps or looping back through a fresh rebase and archive after losing a race
during the checks wait.

#### Scenario: Two tickets touching the same capability land back to back

- **WHEN** two tickets whose OpenSpec changes both modify the same capability are both ready to land in
  the same project
- **THEN** their exclusive archive-then-merge steps run one after the other, never overlapping, and the
  second one's archive is computed against the spec state the first one's archive produced

#### Scenario: Unrelated tickets may still prepare concurrently

- **WHEN** a project's merge concurrency allows more than one ticket in the active merge step
- **THEN** more than one ticket may sync, resolve conflicts and run its checks at the same time, but
  only one at a time proceeds through the exclusive archive-then-merge steps

#### Scenario: A ticket loses the race while waiting on its own checks

- **WHEN** two tickets touching the same capability both push their archived branches and are both
  waiting on required checks, and the first one's checks resolve and it lands first
- **THEN** the second ticket's freshness check fails once its own checks resolve, and it rebases and
  re-archives against the first ticket's now-landed spec state before merging

### Requirement: The primary clone is fast-forwarded only after a verified merge

The daemon SHALL fast-forward its primary clone to the landing branch only after the merge this
sequence performed is verified to have landed, using the same verification already required of any
landed ticket. The daemon SHALL NOT push the archive commit to the landing branch directly at any
point in this sequence — only to the ticket's own branch, ahead of the merge.

#### Scenario: No direct push to the landing branch

- **WHEN** a ticket's archive-then-merge sequence runs
- **THEN** every push the sequence makes before the merge targets the ticket's own branch, and the
  landing branch only gains the archive's content through the merge itself

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

### Requirement: Landing brings the ticket's draft pull request out of draft before it reads required checks

When the daemon requests landing for a ticket whose pull request is a draft, it SHALL mark that pull
request ready for review before it reads the pull request's required checks. Bringing a pull request
that is already ready out of draft SHALL be treated as success and SHALL change nothing. A pull
request opened before ticket pull requests were opened as drafts SHALL be handled exactly as before.

#### Scenario: A draft is made ready before its checks are read

- **WHEN** the daemon lands a ticket whose pull request is a draft
- **THEN** it marks the pull request ready for review, and only then reads the pull request's checks

#### Scenario: An already-ready pull request is unaffected

- **WHEN** the daemon lands a ticket whose pull request is not a draft
- **THEN** marking it ready is a no-op and the merge proceeds exactly as before

### Requirement: An absent check rollup on a just-ready pull request is never read as passed

When the landing sequence has just brought a draft pull request out of draft and the pull request's
check rollup is absent, the daemon SHALL NOT treat that absence as the checks having passed and SHALL
NOT merge. It SHALL report the checks as not yet resolved, on the same terms as a pending rollup, so
the landing is retried once the checks the transition started have registered.

#### Scenario: Absence immediately after the transition does not merge

- **WHEN** the daemon marks a draft pull request ready and the rollup is still absent when it reads
  it
- **THEN** no merge happens, and the landing is reported as checks not yet resolved rather than as a
  pass

#### Scenario: A rebase push is re-checked on the head that will land

- **WHEN** the landing sequence pushes a rebased (or archived) branch to a pull request that is
  already out of draft, which starts a fresh run, and the rollup is pending or absent
- **THEN** no merge happens until the checks for that pushed head resolve

### Requirement: A repository with no CI, or one the forge cannot classify, still lands

Before treating an absent rollup as "not yet", the landing sequence SHALL ask the forge whether the
repository has any CI workflows at all. A workflow counts only when it is an active workflow file
under `.github/workflows/`; the forge's built-in dynamic workflows and disabled workflows SHALL NOT
count. When the forge reports there are none, the sequence SHALL merge, with the project's default
`requireCi` as well as without it — a repository with no CI SHALL NOT be stalled on checks that can
never exist — and SHALL record once on the ticket that it landed without CI because the repository
has none.

A failed or unreadable answer SHALL NOT be remembered as an answer: the sequence SHALL ask again,
including a bounded number of immediate retries within one attempt. When the forge still cannot
answer, the sequence SHALL still wait, but only for a bounded grace period measured from the first
attempt for that pull request head, which SHALL NOT restart on a later landing attempt, on a read of a
different head from the forge, or on a pending read. Past that period it SHALL stop waiting, proceed
as for a repository with no CI, and record on the ticket once that it did so. The grace SHALL be
bounded by a documented constant, not an unbounded retry. A pull request head the sequence has not
observed before (for example after a rebase push) starts its own grace.

A pending combined commit status that reports zero statuses SHALL be read as no checks, never as a
pending check.

A repository that does have workflow files SHALL keep the stricter rule: an absent, all-skipped,
cancelled or wrong-head rollup SHALL NOT pass, and only a successful run on the exact head lands. A
project with `requireCi` set to false SHALL still merge on an absent rollup as an explicit override.

#### Scenario: A repository with no workflows merges on an absent rollup

- **WHEN** the landing sequence pushes a head, the rollup is absent, the project's `requireCi` is its
  default, and the forge reports the repository has no CI workflows
- **THEN** the merge proceeds without waiting, and the ticket gets one comment saying it landed
  without CI because the repository has none

#### Scenario: A repository with only dynamic workflows counts as having none

- **WHEN** the forge lists only workflows whose path is outside `.github/workflows/` (or that are
  disabled) and the rollup is absent
- **THEN** the repository is classified as having no CI and the merge proceeds

#### Scenario: A repository with workflows still waits on a fresh absent rollup

- **WHEN** the landing sequence pushes a head, the rollup is absent, and the forge reports the
  repository does have CI workflows
- **THEN** the sequence reports the checks as not yet resolved and does not merge

#### Scenario: A repository with workflows and an all-skipped rollup does not land

- **WHEN** the repository has workflow files and every check in the rollup is skipped
- **THEN** the sequence reports the checks as not yet resolved and does not merge

#### Scenario: A repository with workflows and a success on the head lands

- **WHEN** the repository has workflow files and the rollup for the exact head is a success
- **THEN** the merge proceeds

#### Scenario: A failed classification is retried and not remembered

- **WHEN** the forge's workflow query fails on one attempt and succeeds on the next
- **THEN** the next attempt uses the successful answer rather than the earlier failure

#### Scenario: A forge that cannot classify eventually stops waiting

- **WHEN** the forge cannot say whether the repository has CI and the rollup stays absent past the
  grace period
- **THEN** the sequence merges, and records once on the ticket that it proceeded without
  confirmation that the repository has CI

#### Scenario: The wait for an unclassifiable repository is measured from the first attempt

- **WHEN** the forge cannot say whether the repository has CI across several `merge_done` calls for
  the same head, and the grace period has elapsed since the first of them
- **THEN** the latest call merges and records once that it proceeded without confirmation, and no
  intervening call restarted the wait

#### Scenario: Combined status pending with zero statuses is no checks

- **WHEN** a pull request reports no checks and a combined status of pending with zero statuses
- **THEN** the check state is read as none, not pending

### Requirement: A task ticket whose bound change does not exist lands with the archive skipped
When the daemon lands a ticket of kind `task` and the ticket's bound OpenSpec change exists neither under `openspec/changes/` nor in the archive of the ticket's branch, it SHALL skip archiving, merge normally, and record a status comment on the ticket saying that no OpenSpec change existed and the archive was skipped. A `task` ticket whose change exists SHALL be archived as before. A ticket of kind `change` whose bound change does not exist SHALL still fail the landing with `openspec_archive_blocked`.

#### Scenario: Task ticket with no change directory
- **WHEN** landing is requested for a `task` ticket whose bound change has no directory on its branch
- **THEN** the pull request is merged without an archive commit and the ticket carries a comment that no OpenSpec change existed and the archive was skipped

#### Scenario: Task ticket with a change
- **WHEN** landing is requested for a `task` ticket whose bound change directory exists
- **THEN** the change is archived onto the branch before the merge, as for any ticket

#### Scenario: Change ticket with a missing change
- **WHEN** landing is requested for a `change` ticket whose bound change does not exist
- **THEN** landing fails with `openspec_archive_blocked` and nothing is merged
