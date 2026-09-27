## MODIFIED Requirements

### Requirement: A turn does not run when freshness cannot be established

When the fetch fails, or the primary clone has diverged from `origin/<landingBranch>` and the guarded
recovery defined by `project-overview/clone-recovery` cannot resolve it, the system SHALL NOT dispatch
the curation turn to a runtime. The system SHALL transition the ticket to `blocked` with an owner and an
action naming what could not be verified, instead of leaving the ticket in its prior status or silently
retrying.

When fetching `origin` fails with a transient network or transport error — a connect timeout, a reset
connection, a DNS failure, or "Could not read from remote repository" immediately following one of
those — the system SHALL retry the fetch with bounded backoff (up to 3 attempts total, spread over
roughly 2 minutes) before deciding the checkout could not be verified, logging each attempt. A fetch
failure that is not transient (an authentication or permission failure, a missing repository) SHALL
still fail on the first attempt, with no retry.

#### Scenario: The clone cannot be fast-forwarded

- **WHEN** a curation ticket's turn is dispatched and the project's primary clone has local commits
  that make `origin/<landingBranch>` unreachable by fast-forward, and those commits are not simply the
  stale copy of a rewritten remote — the guarded recovery refuses to reset the clone
- **THEN** no runtime process is spawned for that turn
- **AND** the ticket is transitioned to `blocked` with `{owner: "conductor", action: "..."}` naming
  the project and that its primary clone holds a commit not present on the remote
- **AND** no knowledge write happens as a result of this turn

#### Scenario: The fetch fails transiently and then succeeds on retry

- **WHEN** a curation ticket's turn is dispatched and fetching `origin` for the project's primary
  clone fails once with a transient network error (for example a connect timeout) and a retry within
  the backoff window succeeds
- **THEN** the turn proceeds as though the fetch had succeeded on the first attempt
- **AND** the ticket is never transitioned to `blocked` for this
- **AND** each attempt, including the failed one, is logged

#### Scenario: The fetch itself fails

- **WHEN** a curation ticket's turn is dispatched and fetching `origin` for the project's primary
  clone fails with a non-transient error (an authentication or permission failure, or the repository
  cannot be found) — or with a transient network error that has not cleared after the bounded retries
  above
- **THEN** no runtime process is spawned for that turn
- **AND** the ticket is transitioned to `blocked` with `{owner: "conductor", action: "..."}` naming
  the fetch failure — stating how many attempts were made when more than one was — and, for a
  non-transient error, no retry was attempted first
- **AND** no knowledge write happens as a result of this turn

#### Scenario: A relaunch is checked the same way as a first turn

- **WHEN** a curation ticket that already took one successful turn is relaunched, or takes a second
  turn after a human comment, and at that later point the primary clone cannot be verified current
- **THEN** the later turn is blocked exactly as a first turn would be — freshness from an earlier turn
  is not treated as still valid
