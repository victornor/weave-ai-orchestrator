## MODIFIED Requirements

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
