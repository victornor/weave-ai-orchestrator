## MODIFIED Requirements

### Requirement: YOLO mode is a per-project setting

YOLO mode SHALL be set on a project and SHALL be off for a project that has not set it. There SHALL
be no workspace-wide YOLO setting, and no project SHALL inherit the mode from the workspace. A
project added after this change SHALL start with the mode off.

Whether the mode is on for a given ticket SHALL be determined solely by that ticket's project. That
project SHALL be read from the ticket's own project when it is set, and otherwise from the project of
the role the ticket is assigned to, so a ticket that names a project either way is never treated as
project-less. Only a ticket that names no project — neither its own nor through an assignee role —
SHALL be treated as having no project, and the mode off for it.

The setting SHALL be readable and writable from the web app and from the CLI, and the value the
daemon acts on SHALL be the value those surfaces show.

#### Scenario: Off for a project that has not set it

- **WHEN** neither a project nor anything above it sets the mode
- **THEN** the mode is off for that project and every approval is put to the human exactly as it is without this feature

#### Scenario: A new project starts off

- **WHEN** a project is added while other projects have the mode on
- **THEN** the new project has the mode off

#### Scenario: A ticket with no project

- **WHEN** a ticket names no project, neither its own project nor through an assignee role
- **THEN** the mode is off for it, whatever any project's setting is

#### Scenario: A project-less row assigned to a role resolves its project

- **WHEN** a ticket's own project is null but it is assigned to a project-scoped role whose project has the mode on
- **THEN** the mode is treated as on for that ticket, and its plan and merge approvals are granted exactly as they are for a ticket that carries the project itself

#### Scenario: Changed from either surface

- **WHEN** the human turns the mode on or off for a project from the web app or from the CLI
- **THEN** that project's setting changes and both surfaces then report the new value

## ADDED Requirements

### Requirement: A reviewed auto-approval that did not resolve is caught and surfaced

The daemon SHALL periodically scan, on the same cadence as the auto-merge sweep, for open
`plan_approval` and `merge_approval` decisions that carry the weaver's review (`looked at` or
`looked at, with concerns`) and have been open for longer than a short threshold, on a project where
the mode is on.

A reviewed card the daemon should have granted, but has not, SHALL be granted by the scan where the
card has no other periodic path to a grant — a `plan_approval`, or a `merge_approval` for an
archive-backfill pull request. An ordinary `merge_approval` SHALL continue to be granted by the
auto-merge sweep, subject to its readiness condition.

Any scanned card still unresolved after the threshold SHALL be surfaced once: a system comment on its
ticket naming the card, its review state and the elapsed time, and a wake to the weaver, so that a
reviewed card can no longer sit silently for hours. The surface SHALL be recorded once per card and
SHALL NOT repeat on every scan.

This scan SHALL NOT alter the readiness condition, the review requirement or the reviewed-head guard:
it grants only what the mark path and the auto-merge sweep would already have granted, and it never
grants a card the mode does not cover.

#### Scenario: A missed plan grant is recovered

- **WHEN** a YOLO project's plan approval has been marked looked at but is still open after the threshold
- **THEN** the scan grants it as the `system` actor and the ticket proceeds to implementation, exactly as the mark path would have

#### Scenario: A stale reviewed merge card is surfaced

- **WHEN** a YOLO ticket's `merge_approval` has been marked looked at and is still open after the threshold
- **THEN** the ticket records a system comment naming the card and the time since it was reviewed, and the weaver is woken once about it

#### Scenario: A held card is not granted by the scan

- **WHEN** a reviewed merge card is still open because its reviewed head moved, or because the weaver marked concerns
- **THEN** the scan does not grant it, and the existing hold and re-review behaviour is unchanged

#### Scenario: The surface does not repeat

- **WHEN** the scan runs again over a card it has already surfaced and the card is still open
- **THEN** it records no second comment and wakes no one again for that card

#### Scenario: The mode is off

- **WHEN** a reviewed card's project does not have the mode on
- **THEN** the scan leaves it exactly as it is, waiting for the human

#### Scenario: An unreviewed card is untouched

- **WHEN** an open plan or merge approval has not been marked by the weaver
- **THEN** the scan does not grant it and does not surface it as stale
