## ADDED Requirements

### Requirement: An archive-backfill merge approval stays attached to its finished ticket

Notwithstanding the requirement that a decision created on an already-terminal ticket is not attached
to it, a `merge_approval` the daemon raises for an OpenSpec archive-backfill pull request SHALL keep
its ticket attachment even though the ticket is already `done`. The card exists to decide what
happens to that ticket's own left-behind archive, so it belongs on the ticket's surfaces, where the
human and the weaver can read the archive pull request link and answer it in context.

Such a card SHALL keep the project the ticket belonged to, SHALL keep its own correlation-key bucket
so it neither supersedes nor is superseded by another merge approval, and SHALL be offered to the
weaver for review exactly as a merge approval raised on a live ticket is. It SHALL be recognisable as
an archive-backfill card by carrying the archive pull request it concerns, so the answer path can
land the archive rather than transition the ticket.

#### Scenario: The archive card appears on the finished ticket

- **WHEN** the daemon raises a merge approval for a finished ticket's archive-backfill pull request
- **THEN** the decision's ticket reference is that ticket
- **AND** it carries the archive pull request so a surface can link to it
- **AND** the weaver is woken to review it

#### Scenario: The archive card keeps its own bucket

- **WHEN** an archive-backfill merge approval is created for a finished ticket and another merge approval exists elsewhere
- **THEN** neither supersedes the other

#### Scenario: An ordinary card on a finished ticket is still detached

- **WHEN** a decision that is not an archive-backfill merge approval is created naming an already-terminal ticket
- **THEN** it is created with no ticket attachment, exactly as before

### Requirement: An archive-backfill merge approval is not closed as a stale terminal decision

An open archive-backfill merge approval SHALL be exempt from the paths that close a terminal ticket's
cards: it SHALL NOT be withdrawn by a ticket reaching `done` or `cancelled` (which has already
happened when it is created), and the sweep that withdraws stale decisions on terminal tickets SHALL
NOT withdraw it on age alone. It SHALL remain open and answerable until it is answered or until the
archive pull request it names is no longer pending.

This exemption SHALL apply only to a merge approval carrying an archive-backfill pull request. Every
other decision on a terminal ticket SHALL be withdrawn on exactly the terms it is today.

#### Scenario: The stale sweep leaves the archive card open

- **WHEN** the sweep for stale decisions on terminal tickets runs and an archive-backfill merge approval is older than the grace period
- **THEN** the decision stays `open`

#### Scenario: A reopened ticket completing again does not withdraw its archive card

- **WHEN** a finished ticket with an open archive-backfill merge approval is reopened and reaches `done` again
- **THEN** the archive-backfill merge approval is not withdrawn by the completion

#### Scenario: Any other stale terminal card is still withdrawn

- **WHEN** the stale sweep runs and a decision on a terminal ticket that is not an archive-backfill merge approval is older than the grace period
- **THEN** it is withdrawn exactly as before
