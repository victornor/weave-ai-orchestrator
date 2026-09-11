## Purpose

Defines what it means for a human to hold a worker's session: the daemon's dispatch to that worker is
excluded for as long as the hold lasts, and a hold nobody closes is reconciled and closed
automatically rather than stranding the worker.

## ADDED Requirements

### Requirement: Taking a session holds it exclusively

Taking a worker's session SHALL make that worker's ownership explicit: from the moment it is taken
until it is given back or closed automatically, the system SHALL NOT dispatch a turn to that worker.
Taking SHALL only be possible for a worker that is not currently executing a turn and that does not
already have an open hold; attempting either SHALL be refused rather than silently queued or
overwritten.

#### Scenario: Dispatch is withheld while a session is held

- **WHEN** a human holds a worker's session
- **THEN** the daemon does not dispatch a turn to that worker for as long as the hold is open

#### Scenario: Taking a running worker is refused

- **WHEN** a human attempts to take a worker's session while a turn is executing for it
- **THEN** the attempt is refused and no hold is opened

#### Scenario: Taking an already-held worker is refused

- **WHEN** a human attempts to take a worker's session while another hold on it is already open
- **THEN** the attempt is refused and the existing hold is unaffected

### Requirement: An abandoned hold is reconciled and closed automatically — but only once it has gone quiet, not merely once it is old

A hold SHALL close on its own once it has been open longer than the system's configured abandonment
timeout **and** the session has shown no further activity for the system's configured quiet period,
without requiring a human to give it back and without requiring manual repair of any kind. Elapsed
time alone SHALL NOT be sufficient to close a hold: a hold that continues to show session activity
SHALL NOT be closed automatically, no matter how long it has been open, because closing it would let
the system dispatch a turn into a worktree and session a human may still be actively using — the same
collision the hold exists to prevent. Closing an abandoned hold SHALL perform the same reconciliation
a human's own handback performs, SHALL record that the hold ended by timeout rather than by a human's
handback, and SHALL leave the worker ready for ordinary dispatch again.

#### Scenario: A forgotten hold times out

- **WHEN** a hold has been open longer than the abandonment timeout, and has shown no session
  activity for at least the quiet period, and nobody has given the session back
- **THEN** the system closes the hold on its own, reconciling worktree and session state the same
  way a handback would

#### Scenario: Active use defers automatic closing

- **WHEN** a hold has been open longer than the abandonment timeout, but the session has continued to
  show activity within the quiet period
- **THEN** the system does not close the hold; it remains open and is checked again rather than being
  reconciled and handed back while still in use

#### Scenario: A worker recovers without manual intervention

- **WHEN** a hold closes by timeout
- **THEN** the worker becomes eligible for ordinary dispatch again with no database or operator
  intervention required

#### Scenario: An automatic close is distinguishable from a human handback

- **WHEN** a hold closes by timeout rather than by a human giving the session back
- **THEN** the record of that close states it happened automatically, rather than being indistinguishable from a human's own handback

#### Scenario: The automatic note distinguishes no activity from activity that stopped

- **WHEN** a hold closes by timeout and the session showed no activity at all for the whole time it
  was held
- **THEN** the recorded note says no activity was ever detected

#### Scenario: The automatic note names when activity last happened

- **WHEN** a hold closes by timeout after showing activity that later stopped
- **THEN** the recorded note says activity was observed and states when it was last seen, rather than
  reusing the no-activity wording
