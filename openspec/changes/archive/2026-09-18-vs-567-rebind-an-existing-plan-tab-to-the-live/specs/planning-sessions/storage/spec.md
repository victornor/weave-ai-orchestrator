# planning-sessions/storage — delta

## ADDED Requirements

### Requirement: A plan's conversation follows its planner across a replacement

The system SHALL address every human message on a plan's thread to the plan's live planner. When a
planner is replaced, the plan's thread SHALL be rebound to the replacement, and a thread still bound
to a retired planner SHALL be rebound on the next message. Human messages on that thread that were
skipped as `agent_retired` SHALL be delivered to the live planner once.

#### Scenario: Message after a planner replacement wakes the new planner

- **WHEN** a plan's planner is retired and replaced, and captain sends a message on the plan's thread
- **THEN** the wake is queued for the replacement planner and is not skipped as `agent_retired`

#### Scenario: A message skipped before the repair is replayed once

- **WHEN** a human message on the thread was skipped as `agent_retired`, and the thread is then repaired
- **THEN** that message is queued for the live planner exactly once
