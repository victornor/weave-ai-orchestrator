## ADDED Requirements

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
repository has any CI workflows at all. When the forge reports it has none, the sequence SHALL merge
exactly as it did before this change — a repository with no CI SHALL NOT be stalled on checks that can
never exist.

When the forge cannot answer, the sequence SHALL still wait, but only for a bounded grace period
measured from the moment it pushed the head or brought the pull request out of draft. Past that
period it SHALL stop waiting, proceed as for a repository with no CI, and record on the ticket once
that it did so. The grace SHALL be bounded by a documented constant, not an unbounded retry.

#### Scenario: A repository with no workflows merges on an absent rollup

- **WHEN** the landing sequence pushes a head, the rollup is absent, and the forge reports the
  repository has no CI workflows
- **THEN** the merge proceeds, exactly as it did before this change

#### Scenario: A repository with workflows still waits on a fresh absent rollup

- **WHEN** the landing sequence pushes a head, the rollup is absent, and the forge reports the
  repository does have CI workflows
- **THEN** the sequence reports the checks as not yet resolved and does not merge

#### Scenario: A forge that cannot classify eventually stops waiting

- **WHEN** the forge cannot say whether the repository has CI and the rollup stays absent past the
  grace period
- **THEN** the sequence merges, and records once on the ticket that it proceeded without
  confirmation that the repository has CI
