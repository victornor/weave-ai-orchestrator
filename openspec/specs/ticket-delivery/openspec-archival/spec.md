# ticket-delivery/openspec-archival Specification

## Purpose
Defines what happens when the daemon tries to archive a ticket's OpenSpec change after its work
has landed: a failure is never silent, and the attempt is retried for every ticket kind that can
own a change, not only `change` tickets — so a validation collision between two parallel changes to
the same requirement is always legible, and a change a merged ticket left behind is always
eventually archived without a human or an agent having to notice and repair it by hand.

## Requirements

### Requirement: An archive failure carries the validator's own reason

When the daemon's attempt to archive a ticket's OpenSpec change fails, the recorded reason SHALL
include the actual validation or archive error the `openspec` CLI reported, not merely the command's
exit status. When that error includes guidance on how to resolve it, distinct from the headline
description of what failed, the recorded reason SHALL include that guidance as well.

The failure SHALL be recorded under an error code that distinguishes a refusal `openspec` itself
explained from an attempt that produced no such explanation. The generic, unactionable code used for
an unclassified failure SHALL NOT be used when `openspec` returned a structured reason for refusing.

#### Scenario: A MODIFIED requirement would drop another change's scenarios

- **WHEN** archiving a ticket's change would drop a scenario present in the current spec because a
  MODIFIED requirement in the change's delta predates another, already-archived change to the same
  requirement
- **THEN** the failure recorded on the ticket names the requirement and the dropped scenario(s), in
  the same terms `openspec validate --strict` would report

#### Scenario: The underlying command reports nothing on its error stream

- **WHEN** the `openspec` CLI's archive command exits non-zero and writes its failure detail to its
  structured output rather than its error stream
- **THEN** the recorded failure still carries that detail, not an empty or placeholder message

#### Scenario: A refusal's guidance is not dropped

- **WHEN** `openspec` refuses to archive a change because a capability's rebuilt spec would hold
  content the merge cannot safely account for, and its structured output carries both a headline
  description of the failure and separate guidance on how to resolve it
- **THEN** the recorded failure includes that guidance verbatim, not only the headline description

#### Scenario: A refusal openspec explains is not reported as an unclassified failure

- **WHEN** `openspec`'s archive command refuses with a structured, named reason
- **THEN** the failure recorded on the ticket carries an error code distinct from the code used when
  the archive attempt produced no structured reason at all

### Requirement: Archive backfill covers every ticket kind that can own a change

The reconciliation sweep that archives an OpenSpec change left behind by a finished ticket SHALL
consider every finished ticket that recorded an OpenSpec change, regardless of the ticket's kind.

#### Scenario: A task ticket's tracker change is left behind

- **WHEN** a `task` ticket carrying an OpenSpec tracker change (`skip_specs: true`) finishes without
  its change being archived
- **THEN** the next reconciliation sweep archives that change on the same terms as a `change`
  ticket's

#### Scenario: A ticket with no change is never considered

- **WHEN** a finished ticket recorded no OpenSpec change
- **THEN** the reconciliation sweep does not attempt to archive anything for it

### Requirement: A reconciliation archive failure is recorded, not only logged

When the reconciliation sweep's own attempt to archive a left-behind change fails, the ticket SHALL
receive a record of that failure and the conductor SHALL be notified, on the same terms a failure
at merge time already is — but at most once per ticket for a standing failure, so a change that
keeps failing every sweep does not renotify on every pass.

This SHALL apply equally when the archive itself succeeds but landing it fails: for a project
delivered through pull requests, opening the pull request that carries the archive commit, or that
pull request's own checks failing before it can be merged, SHALL be recorded and notified on the same
terms as an archive failure, never left as a silent, unrecorded state.

#### Scenario: A left-behind change still fails to archive

- **WHEN** the reconciliation sweep's archive attempt for a left-behind change fails
- **THEN** the ticket carries a comment naming the failure and the conductor is woken

#### Scenario: The same failure persists across sweeps

- **WHEN** a ticket's change fails to archive on a later sweep for the same standing reason
- **THEN** the conductor is not woken again for a failure it was already notified of

#### Scenario: The archive succeeds but the backfill pull request cannot be opened

- **WHEN** the reconciliation sweep successfully archives a left-behind change but opening the pull
  request that would carry it fails
- **THEN** the ticket carries a comment naming that failure and the conductor is woken, on the same
  terms as an archive failure

### Requirement: Reconciliation never pushes an archive directly to a protected branch

For a project delivered through pull requests, the reconciliation sweep SHALL NOT push a left-behind
change's archive commit directly to the project's landing or default branch. It SHALL instead commit
the archive on a new branch made from the current landing branch tip, push that branch, and open a
pull request carrying it, leaving the merge to the normal review path.

For a project delivered as a local branch, with no forge and no protected-branch risk, the
reconciliation sweep MAY continue to commit the archive directly on the local landing branch, since
there is no remote push involved.

A push-refusing remote, or any other failure that leaves the backfill pull request unopened, SHALL be
surfaced per the requirement above — never left as an `info`-level log line with no other record.

#### Scenario: A pull-request project's backfill opens a PR

- **WHEN** the reconciliation sweep archives a left-behind change for a project delivered through pull
  requests
- **THEN** the archive commit lands on a new branch, that branch is pushed, and a pull request carrying
  it is opened rather than any commit being pushed to the landing branch directly

#### Scenario: A local-branch project's backfill still commits locally

- **WHEN** the reconciliation sweep archives a left-behind change for a project delivered as a local
  branch
- **THEN** the archive commit is made directly on the local landing branch, since there is no remote
  push and no protected-branch risk

#### Scenario: A push-refusing remote is surfaced, not logged and swallowed

- **WHEN** pushing the backfill branch for a pull-request project's reconciliation is refused by the
  remote
- **THEN** the failure is recorded on the ticket and the conductor is woken, and no part of the failure
  is left as only an `info`-level log line

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

### Requirement: The reconciliation sweep converges pending archive landings and existing strays

The daemon's reconciliation sweep SHALL land the archive pull request of a finished ticket whose change is still unarchived on the landing branch and whose archive pull request is open, so an archive pull request opened at any earlier time is landed without a human having to find it. It SHALL retry a landing that did not complete, on the same cadence, so a landing deferred by pending checks or a stale branch converges.

A landing that has not completed SHALL be retained and retried rather than discarded; a standing landing failure SHALL be recorded on the ticket and the weaver SHALL be woken once per standing failure, on the same terms an archive failure already is.

#### Scenario: A pre-existing open archive pull request is surfaced

- **WHEN** the sweep runs and a finished ticket's change is unarchived while its archive pull request is open
- **THEN** the sweep lands it through the archive landing and raises no decision

#### Scenario: An approved landing deferred by pending checks converges

- **WHEN** an archive pull request could not be merged because required checks were pending or the branch was stale
- **THEN** the sweep retries the landing once the checks resolve, and the archive is eventually merged

#### Scenario: A standing landing failure is recorded once

- **WHEN** an archive landing keeps failing for the same reason across sweeps
- **THEN** the ticket carries a comment naming the failure and the weaver is woken at most once for it

### Requirement: A closed-unmerged archive pull request is recorded and replaced

When the daemon finds that the pull request on a change's archive branch was closed without being merged, it SHALL record that on the ticket and SHALL open a fresh archive pull request from that branch (or a fresh backfill) rather than reopening the closed pull request, and the fresh pull request SHALL be landed like any other archive backfill. The closed pull request SHALL NOT be treated as a pending archive.

#### Scenario: A closed-unmerged pull request does not stop the backfill

- **WHEN** the archive branch exists and its pull request was closed unmerged
- **THEN** the closure is recorded on the ticket, a fresh pull request is opened and landed, and the closed pull request is not reopened

### Requirement: A pending archive pull request is visible on the ticket's surfaces

While a finished ticket's archive pull request is open and unmerged, the ticket's delivery record
SHALL carry that pull request's URL, and the ticket detail view and the Work board card SHALL show a
"spec archive pending" mark naming the pull request link. The mark SHALL clear once the change is
archived on the landing branch, so a finished ticket's surfaces agree with whether its spec actually
reached the landing branch.

#### Scenario: The ticket shows a pending archive with its link

- **WHEN** a finished ticket's change is unarchived and its archive pull request is open
- **THEN** the ticket detail view and the Work board card show "spec archive pending" with a link to the pull request

#### Scenario: The mark clears once archived

- **WHEN** the archive pull request is merged and the change is present on the landing branch
- **THEN** the ticket's surfaces no longer show a pending archive

### Requirement: A rebuild that openspec refuses records its reason and does not loop

When the daemon's rebuild of a conflicting archive fails because `openspec` refuses the archive, the
daemon SHALL NOT push the rebuilt branch and SHALL NOT merge the pull request. The failure SHALL be
recorded on the ticket carrying `openspec`'s own reason, the weaver SHALL be woken at most once for a
standing failure, and the rebuild SHALL NOT retry in a loop within a single landing attempt.

#### Scenario: openspec refuses the rebuild

- **WHEN** the archive branch's rebase conflicts and rebuilding the archive from the landing tip is refused by `openspec`
- **THEN** the rebuilt branch is not pushed, the pull request is not merged, and the failure recorded on the ticket carries `openspec`'s reason

#### Scenario: The same rebuild failure persists across retries

- **WHEN** the archive landing is retried and the rebuild fails for the same reason again
- **THEN** the weaver is not woken again for a failure it was already notified of

### Requirement: A backfill archive pull request lands without a human card

When the daemon opens, or finds already open, a pull request that carries a finished ticket's OpenSpec archive on its `ac/archive-<change>` branch, it SHALL land that pull request itself, as a system landing, and SHALL NOT create a `merge_approval` decision (or any other human-owned decision) for it. Nothing about an archive backfill SHALL appear in Needs you, and the weaver SHALL NOT be asked to review or dismiss one.

The landing SHALL go through the project-serialized landing a ticket merge uses: it SHALL rebase the archive branch onto the current landing branch tip when stale, SHALL NOT merge while the project's required checks are pending, SHALL merge with the project's configured method, and SHALL leave the archived change present in the landing branch. The ticket SHALL remain `done` and its delivery record SHALL name the change that was archived; the daemon SHALL NOT transition the ticket out of `done`. Neither YOLO mode nor the ticket's `auto_merge` flag SHALL affect whether an archive backfill lands.

When the archive branch is stale and rebasing it onto the current landing tip conflicts, the daemon SHALL NOT retry that rebase. It SHALL instead rebuild the archive from the current landing tip: reset the branch to that tip, ensure the change directory is present — restoring it from the branch's pre-archive parent when the tip no longer carries it — run `openspec archive` so the change's deltas merge into the specs as they now stand, and force-push the rebuilt archive to the same `ac/archive-<change>` branch before continuing with the checks-and-merge path. A clean stale archive branch SHALL continue to take the rebase path. The rebuild SHALL apply only to an archive-backfill landing; a ticket branch whose own rebase conflicts SHALL still be rejected back to its worker, and a conflict the rebuild cannot resolve SHALL not be merged.

#### Scenario: A left-behind change is archived with no card

- **WHEN** a finished ticket has a leftover change folder, the sweep opens its archive pull request, and the checks are green
- **THEN** the pull request is merged by the daemon, the change is archived on the landing branch, the ticket is still `done` with its delivery naming the archived change, and no decision row of any kind exists for the archive

#### Scenario: A pull request found already open is landed, not carded

- **WHEN** the sweep finds an already-open archive pull request for a finished ticket whose change is unarchived
- **THEN** it lands that pull request and opens neither a second pull request nor a decision

#### Scenario: Pending checks defer the landing

- **WHEN** the archive pull request's required checks are pending
- **THEN** it is not merged on that pass, and a later sweep lands it once the checks resolve

#### Scenario: A stale archive branch is rebased

- **WHEN** the archive branch has fallen behind the landing branch and rebasing it applies cleanly
- **THEN** the daemon rebases it onto the current landing tip before merging

#### Scenario: A conflicting archive branch is rebuilt from the landing tip

- **WHEN** rebasing the archive branch onto the landing tip conflicts because a spec file the archive rewrites changed on the tip since the branch was cut
- **THEN** the daemon rebuilds the archive from the current tip, force-pushes the rebuilt branch and merges it, and the resulting spec keeps the tip's requirements plus the change's own

#### Scenario: A normal ticket branch is never rebuilt

- **WHEN** a worker requests landing for its own ticket branch and rebasing that branch conflicts
- **THEN** the request is rejected back to the worker as before, and no archive rebuild is attempted

#### Scenario: YOLO and auto-merge do not matter

- **WHEN** the project runs under YOLO mode or the ticket carries `auto_merge`, or neither
- **THEN** the archive pull request is landed the same way, by the daemon, with no decision raised

### Requirement: An archive card left open by an earlier version is withdrawn

The reconciliation sweep SHALL withdraw any open `merge_approval` decision whose correlation key names an archive backfill (`merge_approval:archive:…`) for a finished ticket, and SHALL land that ticket's pending archive pull request as above, so an archive card raised before this change clears without a human answering it.

#### Scenario: A stray open card is cleared

- **WHEN** the sweep runs and a finished ticket has an open archive `merge_approval` and a pending archive pull request
- **THEN** the decision is withdrawn and the pull request is landed by the daemon
