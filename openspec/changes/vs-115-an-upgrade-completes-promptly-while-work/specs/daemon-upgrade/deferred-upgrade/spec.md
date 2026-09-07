## MODIFIED Requirements

### Requirement: The upgrade proceeds only when no work is running

The upgrade SHALL remain in `waiting` until no run is executing in the daemon process in any loaded
workspace, or until the bounded wait below expires, and SHALL then move to `building` either way. While
waiting, the record SHALL report what it is waiting for, so the operator can see which work is holding the
upgrade.

Run records left behind by an earlier daemon process SHALL NOT hold the upgrade, since no such run is
executing.

The wait SHALL be bounded by a configurable interval. On expiry the upgrade SHALL proceed to `building`
without waiting further, exactly as it does when idle is reached naturally, and the record SHALL carry how
many runs were still executing when it did. A run still executing at that point is not cancelled by the
wait itself: it is ended, and its turn resumed, exactly as any run already is when the daemon that was
running it restarts — the upgrade adds no second way for a turn to be interrupted.

#### Scenario: Work finishes and the upgrade proceeds

- **WHEN** the last executing run finishes while an upgrade is waiting
- **THEN** the upgrade moves to building

#### Scenario: The upgrade is requested with nothing running

- **WHEN** an upgrade is requested while no run is executing
- **THEN** it proceeds to building without waiting for anything

#### Scenario: A stale run record from an earlier process

- **WHEN** an upgrade waits while the database still holds a run marked running by an earlier daemon process that is no longer executing it
- **THEN** the upgrade is not held by that record and proceeds to building

#### Scenario: The wait expires

- **WHEN** the bounded wait expires with work still executing
- **THEN** the upgrade proceeds to building without waiting further, and the record shows how many runs were still executing when it did

#### Scenario: A run interrupted by the eventual restart is not lost

- **WHEN** a run is still executing when the wait expires and the upgrade proceeds to switch and restart
- **THEN** that run is ended and its turn resumed exactly as any run is when the daemon running it restarts, once the new daemon is dispatching again

### Requirement: A restart that does not come back healthy is rolled back

If no daemon answers as healthy on the new release within a bounded interval after the restart, and the
record has not already been reconciled as completed in the meantime, `current` SHALL be switched back to
the release that was current before the upgrade, the daemon SHALL be restarted again on it, and the
upgrade SHALL be recorded as failed with a reason identifying the failed restart.

The record's own state, once set by the daemon's own boot-time reconciliation, SHALL be treated as more
authoritative than the restart verification's own health probe: if reconciliation has already recorded the
upgrade as completed by the time the bounded interval is reached, the restart SHALL NOT be rolled back and
the record SHALL NOT be overwritten — the running daemon having already proven itself on the target release
is a fact, and a probe that has not yet answered is not evidence against it. A verdict decided after the
record has already reached any terminal state SHALL leave the record unchanged.

#### Scenario: The new release does not come up

- **WHEN** no healthy daemon answers on the new release within the bounded interval, and the record has not been reconciled as completed
- **THEN** `current` is switched back to the previous release, the daemon is restarted on it, and the upgrade is recorded as failed with the reason

#### Scenario: A slow health probe against an already-reconciled daemon

- **WHEN** the daemon has already been reconciled as completed on the target release, but the restart verification's own health probe has not yet answered within the bounded interval
- **THEN** the restart is not rolled back and the completed record is not overwritten

#### Scenario: A verdict arriving after the record is already terminal

- **WHEN** the restart verification decides its verdict after the record has already reached a terminal state by another means
- **THEN** the record is left unchanged
