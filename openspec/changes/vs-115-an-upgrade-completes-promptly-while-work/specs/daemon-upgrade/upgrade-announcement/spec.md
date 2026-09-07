## ADDED Requirements

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

## MODIFIED Requirements

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
