## MODIFIED Requirements

### Requirement: Landing mutates the primary clone one ticket at a time per project

Landing a ticket mutates the project's primary clone. For a given project, the daemon SHALL perform at
most one landing at a time, so that two tickets finishing concurrently cannot leave the clone on the
wrong branch or fail each other's fast-forward. Landings in different projects SHALL NOT wait for each
other.

For a ticket carrying an OpenSpec change, archiving that change is part of landing, not a step that
follows it: the same one-at-a-time-per-project guarantee SHALL cover the archive-then-merge sequence
in full, from the freshness check against the current landing branch through the merge and the
fast-forward that follows it.

#### Scenario: Concurrent landings in one project are serialised

- **WHEN** two tickets of the same project report their merges as done at the same time
- **THEN** the landings run one after the other, and both tickets reach a correct outcome

#### Scenario: Different projects do not block each other

- **WHEN** tickets of two different projects report their merges as done at the same time
- **THEN** neither landing waits for the other

#### Scenario: Archiving is covered by the same serialization as landing

- **WHEN** two tickets of the same project, both carrying OpenSpec changes, request landing at the same
  time
- **THEN** one ticket's full archive-then-merge sequence completes or fails before the other's begins

### Requirement: The primary clone is kept fast-forwarded to the project's landing branch

The daemon SHALL keep a project's primary clone checked out on, and fast-forwarded to, the project's
own landing branch rather than its default branch, so that every operation performed in the primary
clone reflects what has actually landed there. This is a project-level fact, independent of any one
ticket: a ticket that declares its own landing branch, overriding its project's, does not change which
branch the shared primary clone is kept on, and does not need to — its merge is verified directly
against its own declared branch without requiring the primary clone's checkout to match it.

#### Scenario: The primary clone tracks the landing branch

- **WHEN** the daemon fetches and fast-forwards a project whose landing branch differs from its
  default branch
- **THEN** the primary clone ends up checked out on, and fast-forwarded to, the landing branch

#### Scenario: OpenSpec archives on the landing branch

- **WHEN** a ticket carrying an OpenSpec change lands, for a project whose landing branch differs from
  its default branch
- **THEN** the merge commit on the landing branch already carries the archived specs and the moved
  change folder, and the primary clone is fast-forwarded to that commit — no separate archive commit
  follows it

#### Scenario: A ticket's own override does not move the primary clone

- **WHEN** a ticket whose own landing branch overrides its project's has its merge verified
- **THEN** the primary clone's fetch and fast-forward target is unaffected and remains the project's
  own landing branch
