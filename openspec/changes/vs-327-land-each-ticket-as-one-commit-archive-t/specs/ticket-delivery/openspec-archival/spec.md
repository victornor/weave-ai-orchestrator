## MODIFIED Requirements

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

## ADDED Requirements

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
