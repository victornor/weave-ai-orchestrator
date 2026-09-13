## Purpose
Defines the atomic operation that lands a ticket: archiving its OpenSpec change onto its own branch
and merging that branch, as one project-serialized step triggered by the worker's request to land,
so a ticket's merge and its spec archive can never separate into two commits or leave one done
without the other.

## ADDED Requirements

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
