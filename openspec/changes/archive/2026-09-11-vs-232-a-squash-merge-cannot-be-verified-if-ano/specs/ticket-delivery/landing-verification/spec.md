## MODIFIED Requirements

### Requirement: A landed branch is recognised however it was merged

When a ticket reports its merge as done, the daemon SHALL verify that the branch's content is present
on that ticket's effective landing branch — its own declared landing branch, or otherwise its
project's — before finishing the ticket. Verification SHALL accept each of the following as proof, and
SHALL report which one it used:

- the landing branch contains the merge commit the forge reports for the ticket's pull request,
  when the ticket was delivered as a pull request; a SHA the caller names is a cross-check against
  that forge SHA and SHALL NOT substitute for it;
- the landing branch contains the branch's head commit (a merge commit or a fast-forward);
- the landing branch and the branch's head have identical content;
- the cumulative change the branch makes to its merge base is already present as a single commit the
  landing branch gained since that merge base (a squash merge);
- every commit of the branch is individually present on the landing branch (commits cherry-picked one
  by one).

The number of commits on the branch SHALL NOT affect the outcome: a branch of one commit and a branch
of many commits, squash-merged the same way, SHALL both verify. Verification SHALL NOT require the
ticket branch to have been rebased onto the landing branch immediately before the merge.

A commit SHA the caller names SHALL NOT be accepted as merge-commit proof on its own. Two halves,
both required: the SHA MUST be the merge commit the forge reports for that pull request, and when
the forge cannot confirm it the caller's SHA SHALL NOT be forwarded as proof — ancestry of an
arbitrary commit already on the landing branch would otherwise close a ticket that never merged.
In those cases verification SHALL continue with the other proofs above, and SHALL record in the
outcome why the named SHA was not used as merge-commit proof. When the forge does report a merge
commit, verification SHALL use that SHA even if the caller omitted one.

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

#### Scenario: Squash merge after another commit landed between the branch base and the squash

- **WHEN** a ticket branch of several commits exists, then an unrelated commit lands on the landing
  branch, then that ticket branch is squash-merged against the newer landing tip so the squash
  commit's parent is not the ticket branch's merge-base, and the ticket reports the merge as done
  naming that squash commit as the merge, and the forge reports the same commit for the pull request
- **THEN** verification succeeds and the ticket is finished

#### Scenario: A forge-confirmed merge commit on the landing branch is accepted as proof

- **WHEN** a ticket delivered as a pull request reports its merge as done naming a commit that is an
  ancestor of the landing branch, and the forge reports that same commit as the pull request's merge
  commit, and the branch head is not an ancestor of the landing branch and the branch's cumulative
  patch does not match any commit gained on the landing branch since the branch's merge-base
- **THEN** verification succeeds and the ticket is finished

#### Scenario: An unconfirmed SHA on the landing branch is not itself proof

- **WHEN** a ticket delivered as a pull request reports its merge as done naming a commit that is an
  ancestor of the landing branch, but the forge reports a different merge commit for that pull request
  or cannot confirm the SHA, and no other proof applies
- **THEN** verification fails with an unverified-merge error, and the ticket stays in the merging
  status
- **AND** that outcome SHALL NOT change merely because the named commit is already an ancestor of
  the landing branch

#### Scenario: An omitted merge commit still verifies from the forge

- **WHEN** a ticket delivered as a pull request reports its merge as done without naming a merge
  commit, the forge reports a merge commit for that pull request, that commit is an ancestor of the
  landing branch, and content strategies cannot prove the branch landed
- **THEN** verification succeeds and the ticket is finished

## ADDED Requirements

### Requirement: An unverified merge names what was compared

When merge verification fails, the error SHALL use the unverified-merge error code and SHALL include
details that identify all of: the ticket branch and its resolved head (or that the head could not be
resolved); the landing-branch ref that was checked and that ref's head; the merge commit that was
considered, or why none was used as proof (not reported, not resolvable, not confirmed by the forge,
or in disagreement with the forge); and each proof strategy that was tried, with whether it passed,
failed, or was skipped. The error message SHALL NOT instruct the caller to merge the pull request
first when the forge already reports that pull request as merged.

#### Scenario: Failed verification lists the compared commits and the strategies tried

- **WHEN** a ticket reports its merge as done and verification fails
- **THEN** the unverified-merge error's details include the branch head, the landing ref and its head,
  why any named merge commit was or was not used, and the outcome of each proof strategy

#### Scenario: Failed verification does not tell the caller to merge a PR the forge already merged

- **WHEN** the forge reports the ticket's pull request as merged and verification still fails
- **THEN** the error message does not instruct the caller to merge the pull request first
- **AND** the error details include the forge's reported merge commit and the strategies that failed
