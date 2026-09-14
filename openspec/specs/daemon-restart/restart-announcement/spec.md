# daemon-restart/restart-announcement Specification

## Purpose
Tells each workspace's weaver, and the chat, that the daemon went down and came back when the restart was not an upgrade: when it happened, whether the shutdown was clean or a crash, which worker turns it cut off and is resuming, and whether a start attempt failed.

## Requirements

### Requirement: The daemon records a durable lifecycle across restarts

The daemon SHALL record, in its own database, when it last booted and which release it booted on; when it begins a shutdown, SHALL record that the shutdown is deliberate and why; and when a start attempt fails, SHALL record that it failed with the reason. These records SHALL survive the restart and SHALL be the only source for deciding what kind of restart happened.

#### Scenario: A clean restart

- **WHEN** a daemon that recorded a boot then records a shutdown starts again
- **THEN** the new boot can tell the previous process shut down cleanly

#### Scenario: A crash

- **WHEN** a daemon starts and the previous process recorded a boot but no shutdown after it
- **THEN** the new boot can tell the previous process did not shut down cleanly

#### Scenario: A failed start attempt

- **WHEN** a start attempt fails and a later attempt succeeds
- **THEN** the successful boot reports the failed attempt and its reason

#### Scenario: The very first boot

- **WHEN** a daemon starts with no lifecycle record at all
- **THEN** it records a boot and reports no restart

### Requirement: A non-upgrade restart is announced to the weaver and the chat

On boot, unless the restart was an upgrade, the daemon SHALL enqueue one wake for each loaded workspace's weaver and post one short line on that workspace's primary chat thread through the channel path. The wake SHALL carry when the daemon went down and came back, whether the shutdown was clean, the failed start attempts since the previous boot with their count and last reason, and every worker turn the restart cut off — the worker, its ticket and its run — and SHALL say those turns are resuming.

The wake SHALL come from the system, not a human, and SHALL be idempotent per boot, so that announcing one restart twice cannot enqueue a second wake.

#### Scenario: A clean restart wakes each weaver once

- **WHEN** the daemon comes back after a clean shutdown that is not an upgrade
- **THEN** each loaded workspace's weaver gets one wake naming the down and up times, the clean shutdown, and the turns that were interrupted and are resuming, and the chat gets one short "back up" line

#### Scenario: A crash is reported as unclean

- **WHEN** the previous process left no clean-shutdown record
- **THEN** the wake and the line say the shutdown was unclean rather than clean

#### Scenario: A failed start is named

- **WHEN** a start attempt failed before this boot and a later one succeeded
- **THEN** the wake reports the failed start attempt and its reason

#### Scenario: The first boot is not a restart

- **WHEN** the daemon starts for the first time and has no previous boot record
- **THEN** no restart notice is posted and no wake is enqueued

### Requirement: An upgrade restart keeps its own announcement and gets no second notice

A boot whose release differs from the release the previous boot recorded SHALL be treated as an upgrade restart: the existing `daemon.upgraded` announcement SHALL stand, and no restart notice SHALL be posted or enqueued for it. A later restart that comes back on the same release SHALL be announced as a restart.

#### Scenario: Coming back on a new release

- **WHEN** the daemon boots on a release different from the one the previous boot recorded
- **THEN** only the upgrade announcement is posted, and no restart wake or line is added

#### Scenario: A restart after an upgrade

- **WHEN** the daemon announced an upgrade on one release and later restarts on that same release
- **THEN** the later restart is announced as a restart

### Requirement: The weaver's instructions say what to do with a restart wake

The weaver's always-loaded instructions and skill SHALL describe the restart wake — source `system`, payload `kind: daemon.restarted` — and SHALL say to relay one short paragraph to the human from it (when it went down and came back, clean or crash, the turns that were interrupted and are resuming, and any failed start) and then carry on, adding to the chat's "back up" line rather than repeating it.

#### Scenario: The instructions name the wake

- **WHEN** the weaver's instructions are rendered
- **THEN** they describe the `daemon.restarted` wake and how to handle it
