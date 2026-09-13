## ADDED Requirements

### Requirement: An existing backfill branch without a pull request is continued, not skipped

When the reconciliation sweep finds that a backfill branch for a change already exists on the
remote, it SHALL NOT treat the branch's existence alone as proof that a pull request is pending. It
SHALL determine whether an open pull request whose head is that branch exists: if one does, the
sweep SHALL record that pull request (its pending URL, an activity entry and the ticket event) and
SHALL open no second one; if none does, the sweep SHALL open the pull request from the already-pushed
branch. A sweep that opens or finds the pull request SHALL record it exactly as a first attempt does.
This SHALL hold even when the branch was pushed by an earlier attempt that then failed before it
could open or record the pull request, so that such an attempt converges on a later sweep rather
than being skipped indefinitely.

#### Scenario: A retry after a failure between push and pull-request creation opens the pull request

- **WHEN** a previous sweep archived a change, pushed its backfill branch, and then failed before the
  pull request was opened, so the branch exists on the remote and no pull request does
- **THEN** the next sweep opens the backfill pull request from that branch and records its URL and
  number as the pending pull request
- **AND** it does not skip the change and does not archive or push a second time

#### Scenario: A retry with an already-open pull request records it and opens nothing

- **WHEN** the backfill branch exists on the remote and an open pull request already carries it
- **THEN** the sweep records that pull request as the pending one, records the activity and ticket
  event for it, and opens no second pull request

#### Scenario: A recorded pending pull request is never duplicated

- **WHEN** a backfill pull request has been recorded as pending for a change and the sweep runs again
- **THEN** the sweep opens no second pull request for that change

#### Scenario: A forge that cannot look up a branch still does not skip forever

- **WHEN** the backfill branch exists on the remote and the project's forge cannot report the open
  pull request for a branch
- **THEN** the sweep attempts to open the pull request from the existing branch rather than skipping
  on the branch's existence, and any failure to open it is recorded

### Requirement: The backfill pull request is opened through an invocation the forge accepts

The daemon SHALL open a backfill pull request through an operation the project's forge actually
supports, and SHALL derive the pull request's URL and number from what that operation returns.
When the forge's create operation prints only the pull request's URL and no structured document, the
daemon SHALL accept that URL as the result and parse the pull request number from it. The daemon
SHALL NOT pass an option to the create operation that the forge's underlying command rejects. A
create operation that fails, or whose result carries no usable URL and number, SHALL be recorded and
surfaced on the same terms as any other backfill failure, never discarded.

#### Scenario: The forge's create operation prints only the pull request URL

- **WHEN** the backfill creates a pull request and the forge prints only its URL on standard output
- **THEN** the daemon records that URL and the number parsed from it as the pending pull request

#### Scenario: An option the create operation rejects is a recorded failure

- **WHEN** opening the backfill pull request fails because the forge rejected the invocation
- **THEN** the failure is recorded on the ticket and surfaced, and the sweep does not report the
  change as archived
