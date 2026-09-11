# daemon-shutdown/graceful-drain Specification

## Purpose
Defines how the daemon process itself shuts down: a bounded wait for in-flight turns, a deliberate
cancellation of whatever is still running when that bound is reached, and a kill timeout on every
restart path that never fires before the daemon's own graceful shutdown would have finished — so a
turn longer than a restart's kill timeout is interrupted and recorded, never abandoned as an orphaned
process writing into a closed pipe.

## Requirements

### Requirement: Shutdown waits for in-flight turns for a bounded period, then cancels them deliberately

On receiving a shutdown signal (`SIGTERM`, `SIGINT`, or an equivalent internal stop request), the
daemon SHALL wait for each workspace's in-flight turns to finish naturally for a bounded grace period.
If that period elapses with turns still running, the daemon SHALL cancel each of them through the same
path used to cancel a run on request (`interrupt` mode), then wait a second, bounded period for those
cancellations to be reflected as finished runs before proceeding to close its listeners and databases.

This bound SHALL apply regardless of how the shutdown was triggered, including a shutdown signal that
arrived with no prior drain request over HTTP.

#### Scenario: A turn finishes within the natural-drain window

- **WHEN** the daemon receives a shutdown signal and every in-flight turn finishes before the
  natural-drain grace period elapses
- **THEN** the daemon proceeds to close its listeners and databases without cancelling anything

#### Scenario: A turn is still running when the natural-drain window elapses

- **WHEN** the daemon receives a shutdown signal and a turn is still running once the natural-drain
  grace period elapses
- **THEN** that turn is cancelled through the same path a requested cancellation uses, and the daemon
  waits a further bounded period before continuing to shut down

#### Scenario: A bare signal gets the same bounded treatment as an HTTP-mediated restart

- **WHEN** the daemon process receives `SIGTERM` directly, with no prior `POST /api/daemon/drain` call
  for this shutdown
- **THEN** it still waits its bounded natural-drain grace period and, if needed, cancels running turns
  before exiting — the same sequence a drain-preceded shutdown gets

### Requirement: A cancelled turn's interruption is recorded before the daemon closes its database, whenever that finishes inside the shutdown's own bound

When shutdown cancels a still-running turn, and that turn's cancellation finishes (the runtime process
exits and the turn is finalized) before the second, cancellation-grace period elapses, the daemon
SHALL record that run as interrupted before closing the workspace's database.

A turn whose cancellation does not finish within that second bound MAY still be mid-cancellation when
the daemon exits; this capability does not require waiting for it further, and relies on the existing
boot-time recovery behavior to reconcile it as interrupted at the next daemon start.

#### Scenario: A cancelled turn finishes within the cancellation-grace period

- **WHEN** a turn is cancelled during shutdown and its process exits before the cancellation-grace
  period elapses
- **THEN** the run is recorded as interrupted before the daemon closes that workspace's database

#### Scenario: A cancelled turn does not finish within the cancellation-grace period

- **WHEN** a turn is cancelled during shutdown and its process has not exited once the
  cancellation-grace period elapses
- **THEN** the daemon proceeds to close its listeners and databases without waiting further, and does
  not treat this as an error

### Requirement: Every kill timeout that can follow a shutdown signal exceeds the shutdown's own worst-case bound

The external kill timeout used to forcibly terminate the daemon process after a shutdown signal
(whether a local process-management timeout or an installed service manager's own stop timeout) SHALL
be configured large enough that the daemon's own bounded shutdown sequence (natural-drain grace period
plus cancellation-grace period, plus margin) always has time to complete and exit voluntarily first.

#### Scenario: A turn runs longer than the shutdown's natural-drain grace period, but the daemon still exits on its own

- **WHEN** a turn is still running past the natural-drain grace period during a restart, and the
  daemon proceeds through its bounded cancel-and-wait sequence
- **THEN** the daemon process exits on its own before the external kill timeout would have forcibly
  terminated it

#### Scenario: An externally-installed service manager's stop timeout is not shorter than the daemon's own bound

- **WHEN** a service manager unit for this daemon is generated
- **THEN** its own configured stop timeout is at least as large as the daemon's bounded shutdown
  sequence's worst-case time
