# daemon-upgrade/upgrade-announcement Specification

## Purpose
TBD - created by archiving change vs-76-a-completed-daemon-upgrade-wakes-the-con. Update Purpose after archive.

## Requirements

### Requirement: A terminal upgrade is announced exactly once

An upgrade that has reached `completed` or `failed` SHALL be announced exactly once, in every workspace the daemon has loaded. The upgrade record SHALL carry the marker that says it has been announced, so the announcement survives being interrupted: the daemon SHALL claim an upgrade by writing that marker conditionally on it being unset, and SHALL announce only the upgrades it claimed.

A daemon that starts with no unannounced terminal upgrade SHALL announce nothing. An upgrade that was cancelled before it built SHALL NOT be announced.

#### Scenario: A plain restart

- **WHEN** a daemon starts and no terminal upgrade is unannounced
- **THEN** no message is posted and no wake is enqueued

#### Scenario: The same upgrade across two boots

- **WHEN** a daemon starts twice with the same terminal upgrade in its records
- **THEN** the upgrade is announced on the first boot only

#### Scenario: A cancelled upgrade

- **WHEN** an upgrade is cancelled before the build starts and the daemon restarts afterwards
- **THEN** nothing about it is announced

### Requirement: The human is told over the channel path as soon as the daemon is back

Once the daemon is serving again, the announcement SHALL post one short message on each workspace's primary chat thread through the channel path, not by running a conductor turn, so that it arrives whatever state the conductor is in — paused, gated, busy or waiting.

The message SHALL name the release the daemon is now running and when it came back. It SHALL be short enough to read at a glance; the detail belongs to the conductor's later summary.

#### Scenario: The conductor is paused when the upgrade finishes

- **WHEN** an upgrade is announced while the workspace's conductor is paused
- **THEN** the message is still posted on the primary chat thread

#### Scenario: What the message says

- **WHEN** an upgrade completes and the daemon comes back healthy
- **THEN** the posted message names the version and commit now running and the time it came back

### Requirement: The conductor is woken with what changed

The announcement SHALL enqueue one wake for each workspace's conductor, from the system rather than from a human, carrying: the previous and the new release with their commit and version, when the upgrade started and when it finished, how many runs were drained before the switch, how many of those were still executing when the wait for idle expired and were interrupted by the eventual restart, and how much queued work resumes now, the tickets whose landed work is included in the new release, the database migrations that were applied, and the outcome of the health checks.

The tickets included SHALL be those whose work landed in the workspace between the previous release being built and the new release being built, taken from the record of landed deliveries rather than from a second source of truth.

The conductor's job description SHALL say what to do with the wake: relay a one-paragraph summary to the human that adds to what the chat message already said, then carry on.

#### Scenario: The payload of a completed upgrade

- **WHEN** an upgrade completes
- **THEN** the conductor's wake carries the release pair with their commits, the start and finish times, the drained, interrupted and resumed counts, the landed tickets, the migrations applied and the health checks

#### Scenario: Work that landed after the release was built

- **WHEN** a ticket's work landed after the new release was built
- **THEN** it is not listed as included in that release

### Requirement: "Back up" is a checked claim

The announcement SHALL only state that the system is back up when its health checks pass: the workspace database answers a query, the supervisor is ticking, and at least one runtime adapter is registered. If any check fails, both the message and the wake SHALL name the failing check and SHALL NOT claim the system is fully back up.

#### Scenario: A check fails

- **WHEN** the supervisor is not ticking as the announcement is made
- **THEN** the message names that check as failing instead of reporting that the system is back up

#### Scenario: Every check passes

- **WHEN** all of the checks pass
- **THEN** the announcement reports the system as back up and the wake carries each check's result

### Requirement: A failure or a rollback is announced with the release now running

An upgrade that ended in failure SHALL be announced with its machine-readable reason, its message, and the release the daemon is running now. When the release now running is not the one the upgrade targeted, the announcement SHALL report the upgrade as rolled back rather than as merely failed.

A failure that happened before anything restarted SHALL be announced without waiting for a restart.

#### Scenario: A rolled-back upgrade

- **WHEN** an upgrade failed and the daemon is running a release other than the one it targeted
- **THEN** the announcement reports a rollback, names the reason, and names the release now running

#### Scenario: A build that failed

- **WHEN** an upgrade fails while building, so the daemon never restarts
- **THEN** it is announced with its reason and the release still running, without waiting for a restart

#### Scenario: One workspace cannot be reached

- **WHEN** announcing into one loaded workspace fails
- **THEN** the other workspaces are still announced to

### Requirement: The chat is told an upgrade has started

As soon as a deferred upgrade begins holding dispatch, one short message SHALL be posted on each loaded
workspace's primary chat thread, through the same channel path the completion announcement uses, saying
that the daemon is upgrading and that it will answer once it is back. This SHALL happen exactly once per
upgrade, whatever the wait for idle turns out to take.

A message a human sends to the conductor while dispatch is held SHALL remain queued, exactly as any
message does today, and SHALL be dispatched once dispatch resumes — by cancellation, by the upgrade
completing, or by the new daemon starting and serving again.

#### Scenario: The chat is told before the wait, not after

- **WHEN** a deferred upgrade is requested
- **THEN** a message is posted on the primary chat thread saying the daemon is upgrading, without waiting for the wait for idle to finish first

#### Scenario: A message sent while the upgrade holds dispatch is not lost

- **WHEN** a human sends a message to the conductor while a deferred upgrade holds dispatch
- **THEN** the message is stored and its wake is queued, and it is dispatched once dispatch resumes

#### Scenario: One workspace cannot be reached

- **WHEN** posting the starting message to one loaded workspace fails
- **THEN** the other workspaces still receive it, and the upgrade proceeds regardless
