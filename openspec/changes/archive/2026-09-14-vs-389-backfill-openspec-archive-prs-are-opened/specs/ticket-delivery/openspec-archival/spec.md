## ADDED Requirements

### Requirement: A backfill archive pull request raises one merge approval on its ticket

When the daemon opens, or finds already open, a pull request that carries a finished ticket's
OpenSpec archive on its `ac/archive-<change>` branch, it SHALL raise exactly one open `merge_approval`
decision for that ticket. The decision SHALL be owned by the human, SHALL be attached to the ticket
the archive belongs to even though that ticket is already `done`, SHALL carry the pull request's URL
so every surface renders a link to it, and SHALL be offered to the weaver for review exactly as an
ordinary merge card is.

The daemon SHALL NOT raise a second open card for the same pull request while one is open, whether
the card was raised as the pull request was opened or by a later sweep that found the pull request
already open. Raising the card SHALL NOT change the ticket's status: it stays `done`.

#### Scenario: A first backfill opens a pull request and raises one card

- **WHEN** the daemon backfills an unarchived change, opens its archive pull request, and no card exists yet
- **THEN** one open `merge_approval` is raised on the ticket naming the pull request, and the ticket stays `done`

#### Scenario: A sweep that finds the pull request already open raises the same one card

- **WHEN** the reconciliation sweep finds an already-open archive pull request for a finished ticket whose change is still unarchived and no card is open
- **THEN** it raises one open `merge_approval` for that pull request and opens no pull request

#### Scenario: An open card is not duplicated

- **WHEN** an archive pull request already has an open merge card and the daemon runs again
- **THEN** no second open card is raised for it

### Requirement: Approving an archive merge approval lands the pull request

When the human answers an archive-backfill merge approval `approve`, the daemon SHALL land the
archive pull request through the same project-serialized landing a ticket merge uses: it SHALL rebase
the archive branch onto the current landing branch tip when stale, SHALL NOT merge while the
project's required checks are pending, SHALL merge with the project's configured method, and SHALL
leave the archived change present in the landing branch. The ticket SHALL remain `done`, and its
delivery record SHALL name the change that was archived. The daemon SHALL NOT transition the ticket
out of `done` to land the archive.

#### Scenario: An approved archive lands

- **WHEN** the human approves an archive-backfill merge card and the pull request's checks are green
- **THEN** the pull request is merged, the change is archived on the landing branch, and the ticket is still `done` with its delivery naming the archived change

#### Scenario: A stale archive branch is rebased

- **WHEN** the archive branch has fallen behind the landing branch and the card is approved
- **THEN** the daemon rebases the archive branch onto the current landing tip before merging

#### Scenario: A rebase conflict does not land the archive

- **WHEN** rebasing the archive branch onto the landing tip conflicts
- **THEN** the pull request is not merged, the conflict is recorded on the ticket, and its landing is retried later

### Requirement: An archive merge approval lands only on approval

With YOLO mode off for the ticket's project, the daemon SHALL NOT merge an archive-backfill pull
request until its merge card has been answered `approve`. A card answered `changes` SHALL record the
human's feedback on the ticket and SHALL NOT merge the pull request. Under YOLO mode the daemon SHALL
grant the approval itself and land the pull request, on the same terms it grants a ticket's merge
approval. The ticket's `auto_merge` flag SHALL have no effect on an archive card, because the ticket
it belongs to is already finished and carries no merge of its own.

#### Scenario: YOLO off, no landing without approval

- **WHEN** an archive pull request is open and its card has not been answered
- **THEN** the pull request is not merged, whatever the project's other policies say

#### Scenario: YOLO on lands the archive without a human

- **WHEN** the project runs under YOLO mode and an archive pull request's card is raised
- **THEN** the daemon answers the card itself and lands the pull request

#### Scenario: Changes records feedback and does not merge

- **WHEN** the human answers an archive merge card `changes` with a reason
- **THEN** the reason is recorded on the ticket and the pull request is left open and unmerged

### Requirement: The reconciliation sweep converges pending archive landings and existing strays

The daemon's reconciliation sweep SHALL raise the card for a finished ticket whose change is still
unarchived on the landing branch and whose archive pull request is open, so an archive pull request
opened before this change is surfaced without a human having to find it. It SHALL also retry landing
an archive pull request whose card was answered `approve` but whose landing did not complete, on the
same cadence, so a landing deferred by pending checks or a stale branch converges.

An approval whose landing has not completed SHALL be retained rather than discarded; a standing
landing failure SHALL be recorded on the ticket and the weaver SHALL be woken once per standing
failure, on the same terms an archive failure already is. A card answered `changes` SHALL NOT be
replaced for the same pull request head until that pull request changes or a fresh backfill replaces
it.

#### Scenario: A pre-existing open archive pull request is surfaced

- **WHEN** the sweep runs and a finished ticket's change is unarchived while its archive pull request is open with no card
- **THEN** the sweep raises the merge card for it

#### Scenario: An approved landing deferred by pending checks converges

- **WHEN** a card was approved and its pull request could not be merged because required checks were pending or the branch was stale
- **THEN** the sweep retries the landing once the checks resolve, and the archive is eventually merged

#### Scenario: A standing landing failure is recorded once

- **WHEN** an approved archive landing keeps failing for the same reason across sweeps
- **THEN** the ticket carries a comment naming the failure and the weaver is woken at most once for it

### Requirement: A closed-unmerged archive pull request is recorded and replaced

When the daemon finds that the pull request on a change's archive branch was closed without being
merged, it SHALL record that on the ticket and SHALL open a fresh archive pull request from that
branch (or a fresh backfill) rather than reopening the closed pull request, so the fresh pull request
raises its own card. The closed pull request SHALL NOT be treated as a pending archive.

#### Scenario: A closed-unmerged pull request does not stop the backfill

- **WHEN** the archive branch exists and its pull request was closed unmerged
- **THEN** the closure is recorded on the ticket and a fresh pull request is opened, which raises its own card, and the closed pull request is not reopened

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
