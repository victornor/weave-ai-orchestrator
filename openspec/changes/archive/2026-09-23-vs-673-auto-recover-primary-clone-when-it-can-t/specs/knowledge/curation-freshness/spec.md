## MODIFIED Requirements

### Requirement: A curation turn only runs once its checkout is verified current

Before a curation-originated ticket's turn is dispatched to a runtime, the system SHALL fetch the
project's primary clone and fast-forward it to `origin/<landingBranch>`. When that fast-forward fails
because the remote's history was rewritten, the system SHALL attempt the guarded recovery defined by
`project-overview/clone-recovery` before deciding the checkout could not be verified. The turn SHALL run
once the clone matches `origin/<landingBranch>` — whether that took a plain fast-forward or recovery from
a rewritten remote. This check SHALL be performed on every turn the ticket takes, not only its first.

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

#### Scenario: The primary clone diverged only because the remote was rewritten

- **WHEN** a curation ticket's turn is dispatched and the project's primary clone cannot be fast-forwarded
  solely because `origin/<landingBranch>`'s history was rewritten since the clone's branch was last
  confirmed to match it
- **THEN** the clone is reset to match `origin/<landingBranch>`'s current tip before the turn runs
- **AND** the turn runs normally, and the ticket is never transitioned to `blocked` for this

### Requirement: A turn does not run when freshness cannot be established

When the fetch fails, or the primary clone has diverged from `origin/<landingBranch>` and the guarded
recovery defined by `project-overview/clone-recovery` cannot resolve it, the system SHALL NOT dispatch
the curation turn to a runtime. The system SHALL transition the ticket to `blocked` with an owner and an
action naming what could not be verified, instead of leaving the ticket in its prior status or silently
retrying.

#### Scenario: The clone cannot be fast-forwarded

- **WHEN** a curation ticket's turn is dispatched and the project's primary clone has local commits
  that make `origin/<landingBranch>` unreachable by fast-forward, and those commits are not simply the
  stale copy of a rewritten remote — the guarded recovery refuses to reset the clone
- **THEN** no runtime process is spawned for that turn
- **AND** the ticket is transitioned to `blocked` with `{owner: "conductor", action: "..."}` naming
  the project and that its primary clone holds a commit not present on the remote
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
