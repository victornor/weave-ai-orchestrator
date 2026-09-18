## ADDED Requirements

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

## REMOVED Requirements

### Requirement: A backfill archive pull request raises one merge approval on its ticket
**Reason**: Archive backfills are housekeeping for work the human already shipped; asking for approval flooded Needs you (eleven cards on 2026-09-18) and the weaver cannot dismiss a `merge_approval`.
**Migration**: The daemon lands the pull request itself; see "A backfill archive pull request lands without a human card".

### Requirement: Approving an archive merge approval lands the pull request
**Reason**: There is no archive card to approve; the landing behaviour it specified (rebase, pending checks, merge method, rebuild on conflict) moves into "A backfill archive pull request lands without a human card".
**Migration**: None; the daemon triggers the landing itself.

### Requirement: An archive merge approval lands only on approval
**Reason**: The approval, YOLO and weaver-review gate it described no longer exists, since no card is raised.
**Migration**: None.

## MODIFIED Requirements

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
