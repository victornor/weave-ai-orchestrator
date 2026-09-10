# interactive-sessions/conversational-posture Specification

## Purpose
Defines the session-wide posture of an interactive session: conversation is the default on every turn, delivery happens only when the human asks for it in that conversation, and a session that ends with an answer alone is complete — not incomplete, stalled, or in need of a liveness repair.

## Requirements

### Requirement: Conversation is the posture for every turn of an interactive session

On every turn of an interactive session, including after the first, the system SHALL instruct the agent that this is a conversation: it answers, investigates, reads and explains. The system SHALL NOT instruct it, on any turn, to carry the ticket through the ordinary worker delivery phases (propose, apply, review, merge) unless that instruction is the escalation path after the human asked for changes in the conversation.

The first-turn wait-for-the-human instruction (read the ticket, post one comment, change nothing, stop) remains a stricter form of this same posture and is unchanged.

#### Scenario: The conversational instruction is present after the first turn

- **WHEN** an interactive session's agent takes its second turn, and again on a later turn after that
- **THEN** that turn's instructions tell it this is a conversation and do not tell it to do the delivery phase its ticket status would ask of an ordinary worker

#### Scenario: The first turn is still the wait-and-report hold

- **WHEN** an interactive session's agent takes its first turn
- **THEN** it is still instructed to read the ticket, post one comment stating understanding and readiness, and take no further action that turn

### Requirement: Delivery actions happen only when the human asked

An interactive session SHALL NOT, of its own accord, modify the repository, transition its ticket toward delivery, or create a plan or merge approval. Those actions SHALL happen only after the human asked for changes in the conversation.

#### Scenario: Several conversational turns do not start delivery

- **WHEN** an interactive session's agent completes two or more turns after its first, and the human has not asked for changes
- **THEN** that session has not been instructed to write a plan, open a pull request, or move the ticket toward delivery

#### Scenario: The human asking for changes joins the ordinary flow

- **WHEN** the human asks an interactive session's agent to make a change, write a plan, or finish the ticket
- **THEN** the agent is permitted to do that work on its own ticket, and the ordinary plan-approval and merge-approval gates apply unchanged

### Requirement: An agent that thinks changes are warranted asks and waits

When an interactive session's agent concludes that a change is warranted and the human has not asked for one, it SHALL say so in the conversation and wait. It SHALL NOT begin planning, editing, or transitioning the ticket while it asks.

#### Scenario: The agent proposes the idea, not the plan

- **WHEN** an interactive session's agent believes a change is warranted and the human has not asked for one
- **THEN** it is instructed to say so in the conversation and wait, and not to start planning or editing in the same turn

### Requirement: A conversation-only ending is complete success

An interactive ticket whose session ends with conversation alone — no plan, no pull request, no status move toward delivery — SHALL NOT be treated as incomplete, stalled, or in violation of ticket liveness. Nothing SHALL wake its worker solely because the ticket is still open and quiet. The existing idle-session end remains the way a silent session is closed.

#### Scenario: An idle interactive ticket is not a liveness violation

- **WHEN** the liveness scan runs against an interactive session whose ticket is still open, whose worker has no run and no wakeup, and whose last turn has finished
- **THEN** that ticket is not reported as a liveness violation and no `liveness_repair` wakeup is enqueued for its worker

#### Scenario: An idle interactive ticket is not a stalled worker

- **WHEN** the stalled-worker scan runs against a worker whose ticket is an interactive session and whose last run is older than the stall threshold
- **THEN** that worker is not detected as stalled

### Requirement: Non-interactive workers are unchanged

A worker whose ticket is not an interactive session SHALL receive the same delivery instructions, the same liveness rules, and the same stalled-worker rules it receives today.

#### Scenario: An ordinary worker still gets the delivery instruction

- **WHEN** a worker whose ticket is not an interactive session takes any turn, including its first and a later one
- **THEN** it is instructed to do the phase its ticket status asks for, exactly as it is today

#### Scenario: An ordinary unfinished ticket can still be a liveness violation or a stall

- **WHEN** a non-interactive ticket meets the existing liveness-violation or stalled-worker conditions
- **THEN** it is reported exactly as it is today
