# agent-attach/live-input Specification

## Purpose
Defines what happens to text a human types at a running agent: it reaches the turn that is executing
when the runtime can genuinely take it, it waits for the next turn when the runtime cannot, and the
human is told which of the two happened every time — so that steering an agent is never a guess about
whether the words arrived.

## Requirements

### Requirement: Text a human sends to a running agent is delivered mid-turn where the runtime supports it

Where the agent's runtime supports delivering input to a turn that is already executing, and a turn
of that agent is executing and still able to receive input, the system SHALL deliver the human's text
to that turn.

The system SHALL treat the text as delivered mid-turn only when the runtime accepted it. A write the
runtime did not accept SHALL NOT be reported as delivered.

#### Scenario: A message to a working agent on a capable runtime

- **WHEN** a human sends text to an agent whose runtime supports mid-turn input and whose turn is
  executing and still able to receive input
- **THEN** the text is delivered to that turn and the outcome is reported as mid-turn delivery

#### Scenario: The runtime does not accept the text

- **WHEN** the runtime's input channel refuses or cannot take the text
- **THEN** the outcome is not reported as mid-turn delivery, and the text is queued instead

### Requirement: Text that cannot be delivered mid-turn is queued for the agent's next turn

Where the runtime does not support mid-turn input, where no turn is executing, or where the executing
turn can no longer receive input, the system SHALL queue the human's text and deliver it at the start
of the agent's next turn, exactly as a message to an idle agent is delivered today.

Text SHALL NEVER be discarded. Every send SHALL end in either mid-turn delivery or a queued delivery,
and SHALL NOT end in neither.

#### Scenario: The agent is between turns

- **WHEN** a human sends text to an agent that has no turn executing
- **THEN** the text is queued and delivered at the start of that agent's next turn

#### Scenario: The turn ends as the text is sent

- **WHEN** a human sends text at the moment the executing turn stops being able to receive input
- **THEN** the text is queued for the next turn rather than lost, and is delivered exactly once

#### Scenario: A runtime with no mid-turn input

- **WHEN** a human sends text to an agent on a runtime that does not support mid-turn input
- **THEN** the text is queued for the next turn and the outcome is reported as queued

### Requirement: The human is told which delivery happened

Every send SHALL report its outcome to the human as either mid-turn delivery or queued delivery. The
interface SHALL show that outcome for the message that was just sent, and SHALL NOT report one
outcome while the other occurred.

#### Scenario: Mid-turn delivery is shown as such

- **WHEN** the human's text is delivered to the executing turn
- **THEN** the interface tells the human it reached the running turn

#### Scenario: Queued delivery is shown as such

- **WHEN** the human's text is queued
- **THEN** the interface tells the human it will be delivered at the start of the agent's next turn

### Requirement: A runtime that cannot take mid-turn input says so rather than pretending

Before the human types, the system SHALL make it discoverable whether mid-turn delivery is available
for that agent right now, and SHALL name the reason when it is not — the runtime does not support it,
or no turn is executing.

An attached view on a runtime without mid-turn input SHALL still show the live activity and SHALL
still offer to send text, described as queued. It SHALL NOT offer mid-turn delivery it cannot perform.

#### Scenario: Attached to an agent on a runtime without mid-turn input

- **WHEN** a human attaches to an agent whose runtime does not support mid-turn input
- **THEN** the live view works as it does for any other agent, the input is offered as queued, and the
  limitation is named

#### Scenario: Capability is discoverable before typing

- **WHEN** a surface asks about an agent before the human types
- **THEN** it learns whether mid-turn delivery is available for that agent and, when it is not, why
