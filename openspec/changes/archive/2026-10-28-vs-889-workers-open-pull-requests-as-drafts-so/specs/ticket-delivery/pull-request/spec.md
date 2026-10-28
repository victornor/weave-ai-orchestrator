## REMOVED Requirements

### Requirement: A ticket's pull request is opened through the daemon, as a draft

**Reason**: A draft pull request cannot be merged, and this repository's CI runs no job while a pull
request is a draft, so the daemon was raising a human `merge_approval` for work that had no checks to
review and could not be landed. The draft was the opener's choice (VS-393), not the worker's, so
charter text could not correct it.

**Migration**: The requirement is replaced by "A ticket's pull request is opened through the daemon,
ready for review" below. Any pull request still opened as a draft — by a worker out of band, or by a
copy of the old tool — is brought out of draft by the `in_review` gate and, as a backstop, by the
landing path that merges it. Archive-backfill pull requests remain drafts because they carry no human
merge card; that is now stated in "Only pull requests the daemon lands itself are drafts".

## ADDED Requirements

### Requirement: A ticket's pull request is opened through the daemon, ready for review

The daemon SHALL offer a worker tool that opens the pull request for the ticket's own branch, using
the project's registered forge adapter. The pull request SHALL be created ready for review, not as a
draft, so that its checks start as soon as it exists. Its base SHALL be the ticket's effective landing
branch — its own `landingBranch` when it declares one, else its project's, else the repository
default — never the repository default when the two differ. Its title and body SHALL be the caller's,
with the ticket reference appended as the delivery skill already does.

#### Scenario: A ready pull request is opened against the landing branch

- **WHEN** a worker calls the tool for a ticket whose effective landing branch is `edge`, having
  pushed its branch
- **THEN** the forge adapter is asked to create a pull request for that branch with base `edge` and
  no draft flag

#### Scenario: The tool opens nothing without a pushed branch

- **WHEN** the worker calls the tool and the branch has not been pushed, so the forge cannot find it
- **THEN** the call fails with the forge's own error and reports it, without recording a work product

### Requirement: A merge approval is never raised for a draft pull request

When a ticket enters `in_review` and its open pull request is reported by the forge as a draft, the
daemon SHALL bring that pull request out of draft before it creates the `merge_approval`, so a human
is never shown a merge card for a pull request that cannot be merged. When the daemon cannot bring it
out of draft — the forge has no mark-ready capability, the call fails, or the pull request is still a
draft afterwards — the daemon SHALL refuse the `in_review` transition with an error naming the pull
request and the action required, and SHALL NOT create a merge approval. When the forge reports the
pull request is not a draft, when the ticket has no pull request, when its project is `local-branch`,
or when the forge cannot be read at all, behaviour SHALL be unchanged. The same rule SHALL apply
when the daemon re-raises a stranded merge approval.

#### Scenario: A draft is corrected before the card

- **WHEN** a ticket's open pull request is a draft and the forge can mark it ready, and the ticket is
  transitioned to `in_review`
- **THEN** the daemon marks the pull request ready before creating the merge approval
- **AND** the ticket is `in_review` with an open merge approval pointing at that pull request

#### Scenario: An uncorrectable draft raises no card

- **WHEN** a ticket's open pull request is a draft and marking it ready fails, and the ticket is
  transitioned to `in_review`
- **THEN** the transition is rejected with an error naming the pull request
- **AND** the ticket is not `in_review`
- **AND** no merge approval is created for it

#### Scenario: A ready pull request is not touched

- **WHEN** a ticket's open pull request is not a draft, and the ticket is transitioned to `in_review`
- **THEN** the daemon does not ask the forge to mark it ready
- **AND** the merge approval is created as before

#### Scenario: A delivery without a pull request is unaffected

- **WHEN** a ticket on `local-branch` delivery, or with no pull-request work product, is transitioned
  to `in_review`
- **THEN** the merge approval is created as before

#### Scenario: The stranded-card repair applies the same rule

- **WHEN** the daemon repairs an `in_review` ticket that has no open merge approval, and its open pull
  request is a draft it cannot bring out of draft
- **THEN** it raises no merge approval for that ticket on that pass

## MODIFIED Requirements

### Requirement: Only pull requests the daemon lands itself are drafts

A pull request SHALL be created as a draft only when the daemon lands it without a human merge card: an
OpenSpec archive-backfill pull request. A ticket's own pull request opened through this tool, and a
pull request the daemon opens for a person to review and merge on the forge — a knowledge-repo switch
or knowledge delivery — SHALL be created non-draft, so the person reviewing it sees a mergeable pull
request with checks. A draft SHALL be brought out of draft by the landing path that merges it, never
by the opener.

#### Scenario: An archive-backfill pull request is a draft

- **WHEN** the daemon opens a pull request to backfill an OpenSpec archive
- **THEN** the forge adapter is asked to create it with `draft` true

#### Scenario: A human-merged knowledge pull request is not a draft

- **WHEN** the daemon opens a knowledge-repo switch or knowledge-delivery pull request for a person
  to merge
- **THEN** the forge adapter is asked to create it non-draft
