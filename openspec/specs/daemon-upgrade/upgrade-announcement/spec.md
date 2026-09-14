# daemon-upgrade/upgrade-announcement Specification

## Purpose
Defines what is announced when a daemon upgrade completes: the human is told over the channel path
and the conductor is woken once per workspace with the release pair, the migrations that ran and
what landed, and a failure or rollback is announced with the release now running rather than left
silent.

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

An upgrade whose record says `completed` SHALL be announced as `completed` only when the release the announcing daemon is executing is the record's target — a match on the release path, or on the commit when the path differs. When the record says `completed` but the daemon is running another release, the announcement SHALL carry a distinct outcome that states the record's claim and the release now running, SHALL NOT carry a success outcome, and both its chat line and its wake reason SHALL say that the upgrade is recorded completed while another release is serving.

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

#### Scenario: The record says completed but another release is serving

- **WHEN** an upgrade row is in state `completed` and neither its target release path nor its target commit matches the release the announcing daemon is running
- **THEN** the announcement is not `completed`, it names the release now running, and its chat line and wake reason both say the upgrade is recorded completed while another release is serving

#### Scenario: The target path differs but the commit matches

- **WHEN** an upgrade row is `completed` and the running release is at a different path but the same commit as the record's target
- **THEN** the announcement reports the upgrade as completed

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

### Requirement: A release containing undelivered ticket-referencing commits says so

A completed upgrade's announcement SHALL determine, from the release directories' own git history between the previous and new release commits, how many commits carry a subject that names one of the workspace's own ticket identifiers (`<PREFIX>-<number>`). When that set contains an identifier not already present among the tickets the delivery records account for, the announcement SHALL report the discrepancy rather than omitting it: both the posted message and the conductor's wake SHALL state how many such commits have no matching delivery record, and the wake SHALL list their identifiers when they can be read from the commit subjects.

This detection SHALL NOT be used to build the list of landed tickets itself: the delivery records remain the only source for that list. A release whose commits cannot be read (for example because the release directory's clone no longer exists) SHALL be treated as having nothing to report, not as an error.

#### Scenario: A ticket's work landed without a delivery record

- **WHEN** a completed upgrade's release window contains a commit named after a ticket that the delivery records do not account for
- **THEN** the posted message and the conductor's wake both say that a change is in the release without a delivery record, and the wake names it when its identifier can be read from the commit subject

#### Scenario: Every ticket-referencing commit is accounted for

- **WHEN** every ticket-referencing commit in a completed upgrade's release window matches a ticket already listed among the landed tickets
- **THEN** the message and the wake read exactly as they do when no such check exists, with nothing added

#### Scenario: The release history cannot be read

- **WHEN** the release directory a completed upgrade targets no longer has a readable git history
- **THEN** the announcement reports nothing about undelivered commits, rather than failing or misreporting a count

### Requirement: The migrations an announcement names are the release's, not the boot's

The announcement SHALL report the database migrations the upgrade introduced — the migration files the target release carries and the source release does not — rather than the migrations the announcing process happened to apply when it opened its databases. The set SHALL be independent of which process ran `migrate`: a migration applied by an earlier process, so that the announcing process's own applied list is empty, SHALL still be named. When the target release's migration files cannot be read, the announcement SHALL name the migrations recorded as applied in the database that the target release carries, and SHALL NOT invent migrations the target does not carry.

#### Scenario: Migrations were applied by an earlier process

- **WHEN** an upgrade's migrations ran in a process other than the one making the announcement, so the announcing process's own applied-migration list is empty
- **THEN** the announcement still names the migrations the release introduced

#### Scenario: A migration the target release did not introduce

- **WHEN** a migration file was already present in the source release
- **THEN** it is not named by the announcement

#### Scenario: Migrations a process applied but the target does not carry

- **WHEN** the database records a migration as applied that the target release does not carry
- **THEN** it is not named by the announcement

### Requirement: The landed list is one entry per ticket, newest first, and states what its cap left out

The landed tickets the announcement carries SHALL list each ticket at most once, at its most recent landing, newest first, so that a ticket that landed twice in a release window appears once. The cap over that list SHALL keep the newest landings. When the cap leaves one or more landed tickets out, the announcement's chat line and its wake payload SHALL both state how many landed tickets were not listed; when it hides nothing, no such statement SHALL be made.

#### Scenario: A ticket landed twice in the window

- **WHEN** one ticket has two landed delivery rows in the release window, at different times
- **THEN** the announcement lists it once, at its most recent landing

#### Scenario: More landed tickets than the cap

- **WHEN** more tickets landed in the window than the cap allows
- **THEN** the newest are listed, the oldest are left out, and both the chat line and the wake payload state how many were not listed

#### Scenario: Under the cap

- **WHEN** every landed ticket fits within the cap
- **THEN** neither the chat line nor the wake payload carries a "not listed" statement

### Requirement: The announcement's run counts are what the restart actually recorded

The announcement's count of interrupted turns SHALL be read from the records the restart left — the turns the shutdown recorded as interrupted — and its count of resumed work SHALL be how many of those turns' wakes were left queued to start again. Neither SHALL be taken from a snapshot of what was running before the restart, so the two agree with what finalize and boot recovery actually did.

A turn that was still running when the wait for idle expired but finished before the restart SHALL NOT be counted as interrupted. A wake queued for a reason other than resuming an interrupted turn SHALL NOT be counted as resumed.

#### Scenario: The counts match the recorded interruptions

- **WHEN** an upgrade comes back and its restart recorded some turns interrupted and queued their wakes to resume
- **THEN** the announcement's interrupted count is the number of those recorded turns and its resumed count is the number of their queued wakes, not the number that were still executing when the wait for idle expired

#### Scenario: A turn that finished before the restart is not interrupted

- **WHEN** a turn was still running when the wait for idle expired but finished before the restart
- **THEN** the announcement does not count it as interrupted

#### Scenario: Unrelated queued work is not counted as resumed

- **WHEN** a wake was already queued for a reason other than resuming a turn the restart interrupted
- **THEN** the announcement's resumed count does not include it
