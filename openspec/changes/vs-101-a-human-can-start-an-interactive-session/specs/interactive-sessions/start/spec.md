## Purpose
Defines how a human starts an interactive session: always against a ticket, either one that already
exists or one created in the same action, with its agent provisioned exactly as any worker's is — so
that a session is never a second, parallel kind of agent, only a worker started on demand.

## ADDED Requirements

### Requirement: A session always has a ticket

The system SHALL let a human start an interactive session only by naming an existing ticket or by
creating one in the same action. A session SHALL NOT exist without a ticket, and the ticket SHALL be
marked as an interactive session at the moment the session starts.

#### Scenario: Starting against an existing ticket

- **WHEN** a human starts a session naming an existing ticket
- **THEN** that ticket is marked as an interactive session and its worker is provisioned

#### Scenario: Starting by creating a ticket

- **WHEN** a human starts a session by creating a new ticket in the same action
- **THEN** the created ticket is marked as an interactive session from the moment it exists, and its
  worker is provisioned

### Requirement: The session's agent is provisioned exactly as a worker's is

Starting a session SHALL give its agent the same worktree, runtime, and the assigned role's charter,
tools and permission mode that spawning a worker for that ticket would give it. Starting a session
SHALL NOT create a second agent for a ticket that already has a live one; it SHALL return the existing
one.

#### Scenario: Provisioning matches a worker's

- **WHEN** a human starts a session against a ticket
- **THEN** the resulting agent has a worktree, a runtime and the assigned role's charter, tools and
  permission mode, exactly as spawning a worker for that ticket would produce

#### Scenario: A ticket that already has a live worker

- **WHEN** a human starts a session against a ticket that already has a live worker
- **THEN** no second agent is created; the existing worker is returned and marked as the session

### Requirement: Starting a session does not wait for the next scheduled spawn

The system SHALL provision a session's agent immediately when the human starts it, rather than
waiting for a periodic pass to notice the ticket needs a worker.

#### Scenario: Immediate provisioning

- **WHEN** a human starts a session against a ticket with no live worker
- **THEN** the agent is provisioned as part of that same action, not on a later scheduled pass
