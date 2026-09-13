## MODIFIED Requirements

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

## ADDED Requirements

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
