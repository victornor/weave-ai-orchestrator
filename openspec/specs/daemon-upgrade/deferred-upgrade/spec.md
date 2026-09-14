# daemon-upgrade/deferred-upgrade Specification

## Purpose
Defines the upgrade the daemon performs on itself: how it is requested and recorded, how it waits for
every running turn to finish before it touches anything, how it is cancelled, how it builds, switches and
restarts, and what happens — at each stage — when it fails. The contract is that an upgrade never
interrupts an agent turn and never leaves the host without a working daemon.

## Requirements

### Requirement: An upgrade is a durable record with a lifecycle

Requesting an upgrade SHALL create a durable record identifying who requested it, the source and ref it
targets, when it was requested, and its state. The record SHALL move only forward through the states
`queued`, `waiting`, `building`, `switching`, `restarting`, and one terminal state of `completed`,
`failed` or `cancelled`.

The record SHALL survive a restart of the daemon, so the outcome of an upgrade is reportable after the
upgrade has restarted the daemon that started it.

Every state change SHALL record when it happened, and every terminal state other than `completed` SHALL
record a machine-readable reason and a human-readable message.

#### Scenario: Requesting an upgrade

- **WHEN** an upgrade is requested
- **THEN** a record is created in the `queued` state identifying the requester, the source and the ref

#### Scenario: The record outlives the daemon that created it

- **WHEN** the daemon restarts after an upgrade record was created
- **THEN** the record and its state are still readable from the daemon that comes back

#### Scenario: A failed upgrade records why

- **WHEN** an upgrade reaches a failed terminal state
- **THEN** the record carries a machine-readable reason and a message describing what failed

### Requirement: Only one upgrade is in flight at a time

While a record is in a non-terminal state, a request for another upgrade SHALL be rejected as a conflict
and SHALL NOT create a second record or disturb the one in flight.

#### Scenario: A second request while one is in flight

- **WHEN** an upgrade is requested while another is in a non-terminal state
- **THEN** the request is rejected as a conflict, and the in-flight upgrade is unchanged

#### Scenario: A request after the previous one finished

- **WHEN** an upgrade is requested after the previous record reached a terminal state
- **THEN** a new record is created and becomes the one in flight

### Requirement: A pending upgrade holds dispatch without interrupting work

As soon as an upgrade record exists, the daemon SHALL stop starting new runs in every workspace it has
loaded, and SHALL leave every run that is already executing to finish on its own. It SHALL NOT cancel,
interrupt or shorten any run, and it SHALL NOT change any workspace's own paused/active state.

Wakes raised while dispatch is held SHALL remain queued and SHALL be dispatched normally once dispatch
resumes, whether it resumes because the upgrade was cancelled, because the restart demonstrably never
replaced the process holding dispatch, or because the new daemon started.

If the restart does not demonstrably replace the process that is holding dispatch within a bounded
verification window, that process SHALL resume dispatch itself and the upgrade SHALL be recorded as
failed — dispatch SHALL NOT remain held indefinitely on the assumption that a replacement is still
coming.

#### Scenario: A run is executing when the upgrade is requested

- **WHEN** an upgrade is requested while a run is executing
- **THEN** that run continues to completion and is not cancelled or interrupted

#### Scenario: A wake arrives while an upgrade is pending

- **WHEN** an agent is woken while an upgrade is pending
- **THEN** no run is started for it while the upgrade is pending, and its wake is still queued

#### Scenario: Dispatch resumes after cancellation

- **WHEN** a pending upgrade is cancelled and an agent has a queued wake
- **THEN** dispatch resumes and a run is started for that wake

#### Scenario: The restart command succeeds but never replaces the serving process

- **WHEN** the restart command that was run for an upgrade reports success, but the process that
  requested the upgrade — and is still holding dispatch — is still the one serving once the bounded
  verification window has passed
- **THEN** that process resumes dispatch itself, a queued wake in it is dispatched, and the upgrade is
  recorded as failed with a reason identifying that the restart was never verified

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

### Requirement: A pending upgrade can be cancelled before it starts building

An upgrade in `queued` or `waiting` SHALL be cancellable. Cancelling SHALL move the record to `cancelled`
and SHALL resume dispatch in every workspace that is not itself paused, leaving a paused workspace paused.

An upgrade that has reached `building` or beyond SHALL NOT be cancellable, and a cancellation request for
it SHALL be rejected without changing the record.

#### Scenario: Cancelling a waiting upgrade

- **WHEN** an upgrade in the waiting state is cancelled
- **THEN** the record becomes cancelled and dispatch resumes

#### Scenario: Cancelling does not resume a paused workspace

- **WHEN** an upgrade is cancelled while one loaded workspace was paused before the upgrade was requested
- **THEN** that workspace remains paused and every other workspace resumes dispatching

#### Scenario: Cancelling once the build has started

- **WHEN** cancellation is requested for an upgrade that has reached the building state
- **THEN** the request is rejected and the upgrade continues

### Requirement: The build happens before anything installed is touched

In `building` the daemon SHALL produce a new release in a fresh directory from the recorded source and
ref, without modifying the running installation, the `current` symlink or any database. Progress output
SHALL be captured on the record as a bounded tail, so what the build is doing and what it printed when it
failed are both readable.

If the build fails for any reason, the upgrade SHALL fail with that reason and the captured output,
dispatch SHALL resume, the `current` symlink SHALL be unchanged, and the daemon SHALL keep running the
release it was running.

#### Scenario: The build fails

- **WHEN** the build of the new release fails
- **THEN** the upgrade fails with the reason and the captured output, dispatch resumes, the `current` symlink is unchanged, and the running daemon is unaffected

#### Scenario: Build progress is readable while it runs

- **WHEN** the record is read while the build is running
- **THEN** it reports the building state and a bounded tail of the build's output

### Requirement: Databases are backed up before the switch

In `switching`, before the `current` symlink is changed, the daemon SHALL back up its own database and
every registered workspace's database, and SHALL record where the backups were written. A failure to back
up SHALL fail the upgrade before the symlink is changed.

#### Scenario: A successful switch

- **WHEN** the upgrade switches to the newly built release
- **THEN** the backups were written first and their location is recorded on the upgrade

#### Scenario: The backup fails

- **WHEN** backing up a database fails
- **THEN** the upgrade fails, the `current` symlink is unchanged, and dispatch resumes

### Requirement: The restart is performed from outside the daemon process and is verified

The daemon SHALL NOT attempt to restart itself from within the request that requested the upgrade. Once
`current` names the new release, the record SHALL move to `restarting` and the restart SHALL be carried
out by a process that is not the daemon being restarted.

The restart SHALL target whichever service-management unit is actually installed on the host, by name —
not a name assumed from the running release's own build. If the restart is carried out through such a
unit and the command that asks it to restart exits non-zero or fails to start, the upgrade SHALL fail
with that command's error output as the message, and SHALL NOT be treated as a restart having been
requested successfully.

The restart SHALL be verified: the upgrade SHALL only be recorded as `completed` once a daemon answers as
healthy, reports the release the upgrade targeted, **and** is confirmed to be the process that replaced
the one being restarted — not merely a daemon that happens to answer on the target release. Where that
confirmation cannot be made on the host, the release-and-health check alone SHALL continue to be
accepted, unchanged from before.

#### Scenario: A verified restart

- **WHEN** the daemon restarts on the new release and answers as healthy reporting that release, and is
  confirmed to be the process that replaced the one being restarted
- **THEN** the upgrade is recorded as completed with the version it came back on

#### Scenario: The restart is not performed inside the request

- **WHEN** an upgrade is requested
- **THEN** the request is answered before the restart happens, and the daemon does not terminate while
  answering it

#### Scenario: The installed unit has a different name than the release being switched to expects

- **WHEN** the host has a service-management unit installed under a name other than the one the newly
  built release's own code would otherwise assume
- **THEN** the restart targets the unit that is actually installed on the host, by its real name

#### Scenario: The restart command itself fails

- **WHEN** the command that asks the installed unit to restart exits non-zero or cannot be started
- **THEN** the upgrade fails with that command's error output as the message, and is not recorded
  completed while the original process is still the one serving

#### Scenario: A daemon other than the one being replaced answers on the target release

- **WHEN** a daemon answers healthy reporting the upgrade's target release, but is not confirmed to be
  the process that replaced the one the restart was meant to restart
- **THEN** the upgrade is not recorded as completed on that answer alone; verification continues

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

An answer from a daemon that is not confirmed to be the process that replaced the one being restarted
SHALL NOT count toward "no daemon answers as healthy" being satisfied; verification SHALL continue to
poll, and only a genuinely unconfirmable answer that exhausts the bounded interval SHALL fall through to
the rollback below.

#### Scenario: The new release does not come up

- **WHEN** no healthy daemon answers on the new release within the bounded interval, and the record has not been reconciled as completed
- **THEN** `current` is switched back to the previous release, the daemon is restarted on it, and the upgrade is recorded as failed with the reason

#### Scenario: A slow health probe against an already-reconciled daemon

- **WHEN** the daemon has already been reconciled as completed on the target release, but the restart verification's own health probe has not yet answered within the bounded interval
- **THEN** the restart is not rolled back and the completed record is not overwritten

#### Scenario: A verdict arriving after the record is already terminal

- **WHEN** the restart verification decides its verdict after the record has already reached a terminal state by another means
- **THEN** the record is left unchanged

#### Scenario: Only an unconfirmed answer, for the whole bounded interval

- **WHEN** a daemon answers healthy on the target release throughout the bounded interval, but is never
  confirmed to be the process that replaced the one being restarted, and reconciliation never records the
  upgrade completed
- **THEN** the bounded interval expires, `current` is switched back to the previous release, the daemon
  is restarted on it, and the upgrade is recorded as failed

### Requirement: A daemon starting up reconciles an unfinished upgrade

A daemon that starts while a record is in `restarting` SHALL reconcile it: if the release it is running is
the one the upgrade targeted, the upgrade SHALL be recorded as completed; if it is not, and the record has
been in `restarting` past a bounded interval, the upgrade SHALL be recorded as failed with a reason
identifying that the restart was not verified.

A record left in any pre-`restarting` non-terminal state by a daemon that is no longer running SHALL be
recorded as failed at startup, so a stale record never holds dispatch in the new process.

When such a pre-`restarting` record is failed at startup, its failure message SHALL state what actually
restarted the daemon rather than a bare statement that the daemon restarted: a service-management unit in
a restart loop, named with its active state and its restart count, or a daemon running outside its
installed unit — a manual start/restart. When neither can be determined on the host, the message SHALL
say so rather than inventing a cause.

#### Scenario: The new daemon is the upgrade's target

- **WHEN** a daemon starts while a record is restarting and the release it is running is that record's target
- **THEN** the upgrade is recorded as completed

#### Scenario: A restart came back on the wrong release

- **WHEN** a daemon starts while a record has been restarting past the bounded interval and the release it is running is not that record's target
- **THEN** the upgrade is recorded as failed with a reason identifying the unverified restart

#### Scenario: A daemon starts with an abandoned waiting record

- **WHEN** a daemon starts while a record is in a non-terminal state before restarting
- **THEN** that record is recorded as failed and the new daemon dispatches normally

#### Scenario: The abandoned record names a restart-looping unit

- **WHEN** a daemon starts while a record is in a non-terminal state before restarting, and the installed unit is in a restart loop
- **THEN** the failed record's message names the restart loop and the unit's active state and restart count

#### Scenario: The abandoned record names an out-of-service daemon

- **WHEN** a daemon starts while a record is in a non-terminal state before restarting, and the daemon that previously served was running outside its installed unit
- **THEN** the failed record's message states that a manual start/restart, not the unit, brought the daemon up

### Requirement: Requesting, cancelling and reading an upgrade require an operator

Requesting an upgrade, cancelling one, and reading upgrade state SHALL require an authenticated operator.
An agent's run token SHALL NOT be sufficient for any of them.

#### Scenario: An agent tries to upgrade the daemon

- **WHEN** an upgrade is requested with a run token rather than an operator session
- **THEN** the request is rejected and no upgrade record is created

### Requirement: The runner never runs a second daemon alongside a live one

When the restart is carried out by stopping and starting the daemon directly, rather than through an
installed unit, the runner SHALL confirm the daemon it is replacing has actually stopped before starting
its replacement. It SHALL NOT start a replacement while anything still answers as healthy at the address
the daemon it meant to stop was reachable at.

#### Scenario: The direct stop actually worked

- **WHEN** the restart is carried out by stopping and starting the daemon directly, and the daemon that
  was asked to stop is confirmed gone
- **THEN** the replacement is started

#### Scenario: Something still answers after the stop was requested

- **WHEN** the restart is carried out by stopping and starting the daemon directly, and something still
  answers as healthy at the address the daemon that was asked to stop was reachable at
- **THEN** the replacement is not started, and the upgrade fails identifying that a daemon was still
  answering

### Requirement: A host on the legacy service-management unit migrates to the current one automatically

When an upgrade's restart finds only a pre-rename service-management unit installed, it SHALL migrate
the host to the current unit as part of that restart, without a separate operator action. Migration
SHALL NOT be attempted outside an upgrade's restart step.

At every point during migration, SHALL be true: never more than one service-management unit for this
daemon is running at once, and never zero for longer than the single stop-then-start exchange an
ordinary same-unit restart already has. The pre-rename unit SHALL remain installed and startable until
the new unit has been verified healthy on the upgrade's target release; only then SHALL it stop being an
active, loadable unit. Its definition SHALL be kept as an inert backup rather than deleted, so what was
installed before migration remains recoverable by hand.

The current unit's definition SHALL be the pre-rename unit's own definition, carried over as-is except
for what names it — never re-derived from this product's own defaults. Whatever the pre-rename unit
said, including any customization beyond this product's own defaults, SHALL still be what the current
unit says after migration, so migration itself is never the reason a customization is lost or a unit
predating some earlier default is treated as unsafe to migrate.

Anything the operator configured on top of the pre-rename unit — at minimum an override/drop-in
directory alongside it — SHALL be carried over to the current unit before the pre-rename one is retired,
and SHALL similarly be kept as a backup rather than deleted.

If bringing the new unit up fails, the upgrade SHALL bring the pre-rename unit back up rather than
leaving the host with no running daemon. If that fallback also succeeds, the upgrade's own success SHALL
be judged on the release restarting successfully, independent of whether migration itself succeeded —
migration failing SHALL NOT by itself fail an upgrade that otherwise completed. Migration SHALL be
attempted again on the next upgrade whenever the pre-rename unit is still the one installed.

The upgrade record SHALL indicate whether that upgrade migrated the unit, fell back to the pre-rename
one, failed before ever touching either unit, or did not attempt migration at all (the host was already
on the current unit) — readable without inspecting logs.

#### Scenario: A host on the legacy unit upgrades

- **WHEN** an upgrade's restart finds only the pre-rename unit installed
- **THEN** the current unit is installed, with the pre-rename unit's own definition carried over as-is
  except for what names it, and started; the pre-rename unit is stopped; once the new unit is verified
  healthy on the target release the pre-rename unit stops being active, its definition is kept only as a
  backup, and the upgrade record shows the unit was migrated

#### Scenario: The operator customized the pre-rename unit

- **WHEN** an upgrade's restart finds only the pre-rename unit installed, and an override/drop-in
  directory exists alongside it
- **THEN** that configuration is carried over to the current unit before the pre-rename unit is retired,
  and is itself kept as a backup rather than deleted

#### Scenario: A pre-rename unit written by an older version of this product

- **WHEN** an upgrade's restart finds only the pre-rename unit installed, and its definition includes
  configuration this product's current defaults no longer set, or a customization the operator made
- **THEN** migration still proceeds, carrying that definition over as-is except for what names it — it
  is never treated as unsafe to migrate on that basis alone

#### Scenario: Migration's cutover fails but the fallback succeeds

- **WHEN** bringing up the current unit during migration fails, and bringing the pre-rename unit back up
  succeeds
- **THEN** the daemon is running under the pre-rename unit on the upgrade's target release, the upgrade
  is not failed by the migration attempt alone, the pre-rename unit is left installed, and the upgrade
  record shows migration fell back to the pre-rename unit

#### Scenario: Neither the new unit nor the fallback comes up

- **WHEN** bringing up the current unit during migration fails, and bringing the pre-rename unit back up
  also fails
- **THEN** the upgrade fails identifying that no daemon could be brought back up

#### Scenario: A host already on the current unit is unaffected

- **WHEN** an upgrade's restart finds the current unit already installed
- **THEN** no migration is attempted, the restart proceeds as an ordinary same-unit restart, and the
  upgrade record shows migration was not attempted

#### Scenario: Migration is retried on a later upgrade

- **WHEN** an upgrade completes without migrating (the cutover fell back to the pre-rename unit)
- **THEN** the next upgrade's restart finds the pre-rename unit still installed and attempts migration
  again
