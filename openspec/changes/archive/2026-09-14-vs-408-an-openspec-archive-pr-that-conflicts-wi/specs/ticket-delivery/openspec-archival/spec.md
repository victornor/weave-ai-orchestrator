## MODIFIED Requirements

### Requirement: Approving an archive merge approval lands the pull request

When the human answers an archive-backfill merge approval `approve`, the daemon SHALL land the
archive pull request through the same project-serialized landing a ticket merge uses: it SHALL rebase
the archive branch onto the current landing branch tip when stale, SHALL NOT merge while the
project's required checks are pending, SHALL merge with the project's configured method, and SHALL
leave the archived change present in the landing branch. The ticket SHALL remain `done`, and its
delivery record SHALL name the change that was archived. The daemon SHALL NOT transition the ticket
out of `done` to land the archive.

When the archive branch is stale and rebasing it onto the current landing tip conflicts, the daemon
SHALL NOT retry that rebase. It SHALL instead rebuild the archive from the current landing tip: reset
the branch to that tip, ensure the change directory is present — restoring it from the branch's
pre-archive parent when the tip no longer carries it — run `openspec archive` so the change's deltas
merge into the specs as they now stand, and force-push the rebuilt archive to the same
`ac/archive-<change>` branch before continuing with the existing checks-and-merge path. The rebuilt
spec SHALL keep the requirements the landing tip already had and add the change's own requirements,
and the change SHALL be present under `openspec/changes/archive/`.

A clean stale archive branch SHALL continue to take the existing rebase path, unchanged. The rebuild
SHALL apply only to an archive-backfill landing; a ticket branch whose own rebase conflicts SHALL
still be rejected back to its worker, and a conflict the rebuild cannot resolve SHALL not be merged.

#### Scenario: An approved archive lands

- **WHEN** the human approves an archive-backfill merge card and the pull request's checks are green
- **THEN** the pull request is merged, the change is archived on the landing branch, and the ticket is still `done` with its delivery naming the archived change

#### Scenario: A stale archive branch is rebased

- **WHEN** the archive branch has fallen behind the landing branch, the card is approved, and rebasing it onto the current landing tip applies cleanly
- **THEN** the daemon rebases the archive branch onto the current landing tip before merging

#### Scenario: A conflicting archive branch is rebuilt from the landing tip

- **WHEN** rebasing the archive branch onto the current landing tip conflicts because a spec file the archive rewrites has changed on the landing tip since the branch was cut
- **THEN** the daemon rebuilds the archive from the current landing tip, force-pushes the rebuilt branch, and merges it, and the resulting spec keeps the landing tip's requirements plus the change's own
- **AND** the rebuilt branch carries the change under `openspec/changes/archive/`

#### Scenario: A normal ticket branch is never rebuilt

- **WHEN** a worker requests landing for its own ticket branch and rebasing that branch onto the landing tip conflicts
- **THEN** the request is rejected back to the worker as before, and no archive rebuild is attempted

#### Scenario: A rebase conflict does not land the archive

- **WHEN** rebasing the archive branch onto the landing tip conflicts and rebuilding the archive from the landing tip cannot be completed
- **THEN** the pull request is not merged, the failure is recorded on the ticket, and its landing is retried later

## ADDED Requirements

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
