## Purpose

Defines what the daemon accepts as proof that a ticket's branch has landed on its project's default
branch before the ticket is finished, so that a real merge — including a squash of a multi-commit
branch — is never rejected, an unmerged branch is never accepted, and two tickets landing at once
never corrupt the shared primary clone.

## ADDED Requirements

### Requirement: A landed branch is recognised however it was merged

When a ticket reports its merge as done, the daemon SHALL verify that the branch's content is present
on the project's default branch before finishing the ticket. Verification SHALL accept each of the
following as proof, and SHALL report which one it used:

- the default branch contains the branch's head commit (a merge commit or a fast-forward);
- the default branch and the branch's head have identical content;
- the cumulative change the branch makes to its merge base is already present as a single commit the
  default branch gained since that merge base (a squash merge);
- every commit of the branch is individually present on the default branch (commits cherry-picked one
  by one).

The number of commits on the branch SHALL NOT affect the outcome: a branch of one commit and a branch
of many commits, squash-merged the same way, SHALL both verify.

#### Scenario: Squash merge of a multi-commit branch

- **WHEN** a branch of several commits is squash-merged into the default branch and its ticket reports
  the merge as done
- **THEN** verification succeeds and the ticket is finished

#### Scenario: Squash merge with later commits on the default branch

- **WHEN** a branch of several commits is squash-merged and unrelated commits land on the default
  branch afterwards, and its ticket then reports the merge as done
- **THEN** verification succeeds and the ticket is finished

#### Scenario: Ordinary merge commit

- **WHEN** a branch is merged into the default branch such that the default branch contains the
  branch's head
- **THEN** verification succeeds and the ticket is finished

#### Scenario: An unmerged branch is refused

- **WHEN** a ticket reports its merge as done while its branch's changes are absent from the default
  branch
- **THEN** verification fails with an unverified-merge error naming the branch and the default branch,
  and the ticket stays in the merging status

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
