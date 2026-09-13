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
