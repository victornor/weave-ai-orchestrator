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

### Requirement: A turn cut off by daemon shutdown is interrupted whatever its exit says, and resumes on its own

While the daemon is shutting down, or draining for a restart — a plain `SIGTERM` stop, `POST /api/daemon/drain`, or a deferred upgrade whose wait for idle expired and whose restart stops the daemon — it SHALL record that fact before any child process can be terminated, and every turn still active at that moment SHALL be finalized as `interrupted` regardless of the child's exit code or of any error the runtime attached to its result. A turn that had already succeeded SHALL keep its success.

The interrupted turn's worker SHALL be left able to run again and its wakes SHALL be left to start again rather than being marked failed, so that the next daemon's dispatcher resumes the turn with no human approval. A wake a human cancelled, or a failure that happened without a shutdown, SHALL keep its existing behavior and raise no resume.

#### Scenario: A runtime reports an error on a SIGTERM exit during shutdown

- **WHEN** the daemon is shutting down and a turn's runtime returns a non-zero exit with an error attached, as the claude adapter does for exit 143
- **THEN** the turn is recorded `interrupted`, not `failed`

#### Scenario: A runtime exits 1 as its process group is stopped

- **WHEN** the daemon is shutting down and a turn's runtime returns exit 1, as the opencode adapter does when its parent is terminated
- **THEN** the turn is recorded `interrupted`, not `failed`

#### Scenario: An interrupted turn resumes without a human

- **WHEN** a turn is recorded `interrupted` because of a shutdown
- **THEN** its wake is left queued and its worker active, and the next daemon starts the turn again without a retry approval

#### Scenario: A deferred upgrade's restart covers the runs its wait left executing

- **WHEN** a deferred upgrade's wait for idle expires with turns still running and its restart stops the daemon
- **THEN** each of those turns is recorded `interrupted` and left queued to resume, not `failed`, whichever runtime it used

#### Scenario: A genuine failure outside shutdown is unchanged

- **WHEN** a turn fails while the daemon is neither shutting down nor draining
- **THEN** it is classified exactly as before, with no resume

#### Scenario: A drain that is undone resumes rather than strands

- **WHEN** `POST /api/daemon/drain` cancels a turn and the restart never happens, so dispatch is resumed
- **THEN** the cancelled turn becomes eligible to run again on the ordinary dispatcher cadence
