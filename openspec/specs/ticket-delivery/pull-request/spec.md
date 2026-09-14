# ticket-delivery/pull-request Specification

## Purpose
Defines how a ticket's pull request is opened: through the daemon's forge adapter as a draft, so the
opener is deterministic (workers cannot forget the draft flag or the work-product record), the base
is the ticket's effective landing branch, and only projects on `pr` delivery with a forge that can
open pull requests are served.

## Requirements

### Requirement: A ticket's pull request is opened through the daemon, as a draft

The daemon SHALL offer a worker tool that opens the pull request for the ticket's own branch, using
the project's registered forge adapter. The pull request SHALL be created as a draft. Its base SHALL
be the ticket's effective landing branch — its own `landingBranch` when it declares one, else its
project's, else the repository default — never the repository default when the two differ. Its title
and body SHALL be the caller's, with the ticket reference appended as the delivery skill already
does.

#### Scenario: A draft pull request is opened against the landing branch

- **WHEN** a worker calls the tool for a ticket whose effective landing branch is `edge`, having
  pushed its branch
- **THEN** the forge adapter is asked to create a pull request for that branch with base `edge` and
  `draft` true

#### Scenario: The tool opens nothing without a pushed branch

- **WHEN** the worker calls the tool and the branch has not been pushed, so the forge cannot find it
- **THEN** the call fails with the forge's own error and reports it, without recording a work product

### Requirement: Opening a ticket's pull request is idempotent per branch

When an open pull request already exists for the ticket's branch, the daemon SHALL return that pull
request and record the work product for it, and SHALL NOT create a second pull request for the same
branch. The daemon SHALL NOT change the draft state of a pull request it did not open: an existing
non-draft pull request SHALL stay non-draft.

#### Scenario: A second call reuses the open pull request

- **WHEN** the tool is called twice for the same branch and the first call opened a draft
- **THEN** the second call returns the same pull request, creates no second one, and records no
  duplicate work product for a different URL

#### Scenario: A pre-existing non-draft pull request is not flipped to draft

- **WHEN** the branch already has an open, non-draft pull request and the tool is called
- **THEN** the tool returns it and leaves its draft state unchanged

### Requirement: The tool refuses anything but a pull-request-delivery project with a forge

When the ticket's project uses `local-branch` delivery, or no forge adapter that can open a pull
request is registered for it, the tool SHALL fail with a clear validation error that tells the worker
its delivery mode and that it should follow it. It SHALL NOT open a pull request by any other means,
and SHALL NOT shell out to a forge CLI as a hidden fallback.

#### Scenario: Local-branch delivery is refused

- **WHEN** the tool is called for a project whose `deliveryMode` is `local-branch`
- **THEN** it fails with a validation error naming the delivery mode, and no pull request is opened

#### Scenario: No forge adapter is refused

- **WHEN** the tool is called for a `pr`-delivery project with no registered forge that can open a
  pull request
- **THEN** it fails with a validation error, and nothing is opened and nothing is recorded

### Requirement: The daemon records the pull-request work product

On success — a pull request created or an existing one reused — the daemon SHALL record the ticket's
`pull_request` work product with the pull request's URL and title, so the ticket carries the link
whether or not the worker records one itself.

#### Scenario: The work product is recorded with the pull request

- **WHEN** the tool returns a pull-request URL
- **THEN** the ticket has a `pull_request` work product whose URL is that URL

### Requirement: Only pull requests the daemon lands itself are drafts

A pull request SHALL be created as a draft only when the daemon itself will land it: a ticket's own
pull request opened through this tool, and an OpenSpec archive-backfill pull request. A pull request
the daemon opens for a person to review and merge on the forge — a knowledge-repo switch or knowledge
delivery — SHALL be created non-draft, so merging it needs no manual step to bring it out of draft.
A draft SHALL be brought out of draft by the landing path that merges it, never by the opener.

#### Scenario: An archive-backfill pull request is a draft

- **WHEN** the daemon opens a pull request to backfill an OpenSpec archive
- **THEN** the forge adapter is asked to create it with `draft` true

#### Scenario: A human-merged knowledge pull request is not a draft

- **WHEN** the daemon opens a knowledge-repo switch or knowledge-delivery pull request for a person
  to merge
- **THEN** the forge adapter is asked to create it non-draft
