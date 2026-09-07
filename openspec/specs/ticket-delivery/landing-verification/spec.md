# ticket-delivery/landing-verification Specification

## Purpose
Defines what the daemon accepts as proof that a ticket's branch has landed on its project's default
branch before the ticket is finished, so that a real merge — including a squash of a multi-commit
branch — is never rejected, an unmerged branch is never accepted, and two tickets landing at once
never corrupt the shared primary clone.

## Requirements

### Requirement: A landed branch is recognised however it was merged

When a ticket reports its merge as done, the daemon SHALL verify that the branch's content is present
on that ticket's effective landing branch — its own declared landing branch, or otherwise its
project's — before finishing the ticket. Verification SHALL accept each of the following as proof, and
SHALL report which one it used:

- the landing branch contains the branch's head commit (a merge commit or a fast-forward);
- the landing branch and the branch's head have identical content;
- the cumulative change the branch makes to its merge base is already present as a single commit the
  landing branch gained since that merge base (a squash merge);
- every commit of the branch is individually present on the landing branch (commits cherry-picked one
  by one).

The number of commits on the branch SHALL NOT affect the outcome: a branch of one commit and a branch
of many commits, squash-merged the same way, SHALL both verify.

#### Scenario: Squash merge of a multi-commit branch

- **WHEN** a branch of several commits is squash-merged into the landing branch and its ticket reports
  the merge as done
- **THEN** verification succeeds and the ticket is finished

#### Scenario: Squash merge with later commits on the default branch

- **WHEN** a branch of several commits is squash-merged and unrelated commits land on the landing
  branch afterwards, and its ticket then reports the merge as done
- **THEN** verification succeeds and the ticket is finished

#### Scenario: Ordinary merge commit

- **WHEN** a branch is merged into the landing branch such that the landing branch contains the
  branch's head
- **THEN** verification succeeds and the ticket is finished

#### Scenario: An unmerged branch is refused

- **WHEN** a ticket reports its merge as done while its branch's changes are absent from the landing
  branch
- **THEN** verification fails with an unverified-merge error naming the branch and the landing branch,
  and the ticket stays in the merging status

#### Scenario: Work merged onto the default branch alone does not satisfy a declared landing branch

- **WHEN** a project declares a landing branch different from its default branch, a ticket's branch is
  merged into the default branch but never reaches the landing branch, and its ticket then reports the
  merge as done
- **THEN** verification fails with an unverified-merge error naming the branch and the landing branch,
  and the ticket stays in the merging status

#### Scenario: A ticket's own override is what verification checks, not its project's landing branch

- **WHEN** a ticket declares its own landing branch overriding its project's, its branch is merged into
  the ticket's own declared landing branch, and its ticket reports the merge as done
- **THEN** verification succeeds against the ticket's own declared landing branch

#### Scenario: Merging onto the project's landing branch does not satisfy a ticket's own override

- **WHEN** a ticket declares its own landing branch overriding its project's, its branch is merged into
  the project's landing branch but never reaches the ticket's own declared landing branch, and its
  ticket reports the merge as done
- **THEN** verification fails with an unverified-merge error naming the branch and the ticket's own
  declared landing branch, and the ticket stays in the merging status

### Requirement: Landing mutates the primary clone one ticket at a time per project

Landing a ticket mutates the project's primary clone. For a given project, the daemon SHALL perform at
most one landing at a time, so that two tickets finishing concurrently cannot leave the clone on the
wrong branch or fail each other's fast-forward. Landings in different projects SHALL NOT wait for each
other.

#### Scenario: Concurrent landings in one project are serialised

- **WHEN** two tickets of the same project report their merges as done at the same time
- **THEN** the landings run one after the other, and both tickets reach a correct outcome

#### Scenario: Different projects do not block each other

- **WHEN** tickets of two different projects report their merges as done at the same time
- **THEN** neither landing waits for the other

### Requirement: A project may declare a landing branch distinct from its default branch

A project SHALL be able to declare, optionally, the branch its tickets' work is expected to reach:
its landing branch. When a project declares no landing branch, its landing branch SHALL be its default
branch, so that a project which declares nothing behaves exactly as it did before this capability
existed. Promoting a project's landing branch to its default branch — merging `edge` into `main`, in
Fernwood's case — SHALL remain entirely outside the daemon: no worker, and no part of the daemon, ever
pushes or merges that promotion.

#### Scenario: A project with no declared landing branch behaves as before

- **WHEN** a project declares no landing branch
- **THEN** every check that verifies where a ticket's work has landed runs against that project's
  default branch, exactly as before landing branches existed

#### Scenario: A declared landing branch is used instead of the default branch

- **WHEN** a project declares a landing branch different from its default branch
- **THEN** every check that verifies where a ticket's work has landed runs against the declared
  landing branch, and none of them touch the default branch

#### Scenario: Promotion stays a human's action

- **WHEN** a project's landing branch differs from its default branch
- **THEN** nothing the daemon or a worker does merges or pushes the landing branch into the default
  branch

### Requirement: A ticket may declare its own landing branch, overriding its project's

A ticket SHALL be able to declare, at creation, its own landing branch, distinct from its project's.
When a ticket declares one, every check that verifies where that ticket's work has landed, every
worktree created for it, and everything that ticket's own worker is told, SHALL use the ticket's own
landing branch instead of its project's. When a ticket declares none, it SHALL use its project's
landing branch, which itself falls back to the project's default branch when the project declares
none. A ticket's landing branch SHALL be set only when the ticket is created, and SHALL NOT be inferred
from a pull request's base branch or from any other property of how or where the ticket's work happens
to be delivered: an inferred override would let a worker choose its own verification target by
choosing where it opens its PR.

#### Scenario: A ticket's own landing branch overrides its project's

- **WHEN** a ticket declares a landing branch different from its project's
- **THEN** every check that verifies where that ticket's work has landed, the worktree created for it,
  and that ticket's own worker brief, all use the ticket's own landing branch

#### Scenario: A ticket with no declared landing branch uses its project's

- **WHEN** a ticket declares no landing branch
- **THEN** every check that verifies where that ticket's work has landed runs against its project's
  landing branch

#### Scenario: The override is never inferred from where a PR is opened

- **WHEN** a ticket's work is delivered through a pull request opened against some branch
- **THEN** the branch that pull request was opened against is not, by itself, used as that ticket's
  landing branch — only a value declared on the ticket at its creation is used

### Requirement: A ticket's worktree is created from, and checked against, its effective landing branch

A worker's worktree SHALL be created from its ticket's effective landing branch — the ticket's own
declaration, or otherwise its project's — rather than the project's default branch, when they differ,
so a ticket's branch starts from what its own work is actually going to reach. The landed-work test
that decides whether a finished worker's worktree can be discarded SHALL check the branch's content
against that same effective landing branch, for the same reason: a branch merged onto its landing
branch has landed even while that branch itself has not yet been promoted to the project's default
branch.

#### Scenario: A new worktree starts from its ticket's effective landing branch

- **WHEN** a worker is spawned for a ticket whose effective landing branch differs from its project's
  default branch
- **THEN** the worktree is created from that effective landing branch

#### Scenario: The landed-work test checks the ticket's effective landing branch

- **WHEN** a finished worker's worktree is checked to see whether it can be discarded, for a ticket
  whose effective landing branch differs from its project's default branch
- **THEN** the check verifies the branch's content against that effective landing branch, not the
  project's default branch

#### Scenario: Landed on the landing branch, not yet promoted, still counts as landed

- **WHEN** a ticket's branch has landed on its effective landing branch and that branch has not yet
  been promoted to the project's default branch
- **THEN** the worker's worktree is treated as landed and may be discarded

### Requirement: The primary clone is kept fast-forwarded to the project's landing branch

The daemon SHALL keep a project's primary clone checked out on, and fast-forwarded to, the project's
own landing branch rather than its default branch, so that OpenSpec archiving and every other
operation performed in the primary clone reflects what has actually landed there. This is a
project-level fact, independent of any one ticket: a ticket that declares its own landing branch,
overriding its project's, does not change which branch the shared primary clone is kept on, and does
not need to — its merge is verified directly against its own declared branch without requiring the
primary clone's checkout to match it.

#### Scenario: The primary clone tracks the landing branch

- **WHEN** the daemon fetches and fast-forwards a project whose landing branch differs from its
  default branch
- **THEN** the primary clone ends up checked out on, and fast-forwarded to, the landing branch

#### Scenario: OpenSpec archives on the landing branch

- **WHEN** an OpenSpec change is archived after a ticket's merge is verified, for a project whose
  landing branch differs from its default branch
- **THEN** the archive commit is made and pushed on the landing branch, not the default branch

#### Scenario: A ticket's own override does not move the primary clone

- **WHEN** a ticket whose own landing branch overrides its project's has its merge verified
- **THEN** the primary clone's fetch and fast-forward target is unaffected and remains the project's
  own landing branch
