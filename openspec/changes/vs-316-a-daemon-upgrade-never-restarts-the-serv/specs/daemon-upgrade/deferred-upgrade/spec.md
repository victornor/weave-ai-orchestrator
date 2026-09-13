## MODIFIED Requirements

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

## ADDED Requirements

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
