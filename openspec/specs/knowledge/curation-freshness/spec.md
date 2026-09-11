# knowledge/curation-freshness Specification

## Purpose
Describes the precondition a curation ticket's turn must satisfy before it runs: the primary clone it
will fact-check against must be verified current against the project's landing branch. Governs what
happens, and what is reported to the human, when that cannot be established. Complements
`knowledge/scheduled-curation`, which governs when a curation run is asked for, not what a curation
turn may do once it starts.

## Requirements

### Requirement: A curation turn only runs once its checkout is verified current

Before a curation-originated ticket's turn is dispatched to a runtime, the system SHALL fetch the
project's primary clone and fast-forward it to `origin/<landingBranch>`. The turn SHALL run only when
that fast-forward succeeds. This check SHALL be performed on every turn the ticket takes, not only its
first.

#### Scenario: The primary clone is behind and catches up cleanly

- **WHEN** a curation ticket's turn is dispatched and the project's primary clone is behind
  `origin/<landingBranch>` with no local divergence
- **THEN** the clone is fetched and fast-forwarded to `origin/<landingBranch>` before the turn runs
- **AND** the turn runs, and any fact-check the curator performs against the checkout reflects
  `origin/<landingBranch>`'s current tip, including content added after the clone's previous state

#### Scenario: The primary clone is already current

- **WHEN** a curation ticket's turn is dispatched and the project's primary clone already matches
  `origin/<landingBranch>`
- **THEN** the turn runs without being delayed by the check finding anything to change

### Requirement: A turn does not run when freshness cannot be established

When the fetch fails, or the primary clone has diverged from `origin/<landingBranch>` and cannot be
fast-forwarded, the system SHALL NOT dispatch the curation turn to a runtime. The system SHALL
transition the ticket to `blocked` with an owner and an action naming what could not be verified,
instead of leaving the ticket in its prior status or silently retrying.

#### Scenario: The clone cannot be fast-forwarded

- **WHEN** a curation ticket's turn is dispatched and the project's primary clone has local commits
  that make `origin/<landingBranch>` unreachable by fast-forward
- **THEN** no runtime process is spawned for that turn
- **AND** the ticket is transitioned to `blocked` with `{owner: "conductor", action: "..."}` naming
  the project and that its primary clone could not be fast-forwarded
- **AND** no knowledge write happens as a result of this turn

#### Scenario: The fetch itself fails

- **WHEN** a curation ticket's turn is dispatched and fetching `origin` for the project's primary
  clone fails (offline, authentication failure)
- **THEN** no runtime process is spawned for that turn
- **AND** the ticket is transitioned to `blocked` with `{owner: "conductor", action: "..."}` naming
  the fetch failure
- **AND** no knowledge write happens as a result of this turn

#### Scenario: A relaunch is checked the same way as a first turn

- **WHEN** a curation ticket that already took one successful turn is relaunched, or takes a second
  turn after a human comment, and at that later point the primary clone cannot be verified current
- **THEN** the later turn is blocked exactly as a first turn would be — freshness from an earlier turn
  is not treated as still valid

### Requirement: A curation turn is told where its verified checkout is and when it was verified

When a curation turn runs, the brief SHALL state the primary clone's real, absolute path — not a
placeholder the worker must resolve itself — and the moment the daemon just confirmed it matches
`origin/<landingBranch>`.

#### Scenario: The brief names the real path

- **WHEN** a curation turn's brief is rendered after its checkout was verified current
- **THEN** the brief's reference to the fact-checking checkout resolves to the project's actual clone
  path on disk, and states the time that checkout was last confirmed to match
  `origin/<landingBranch>`
