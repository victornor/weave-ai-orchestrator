## Purpose
Defines the record that attaching leaves behind: the human's words are kept on the ticket as theirs
and appear in the agent's transcript, and they are instruction only — so that nothing said to an
agent directly is invisible to the conductor afterwards, and so that sitting with an agent never
becomes a way around what that agent is allowed to do.

## ADDED Requirements

### Requirement: What the human types is recorded on the ticket as their words

Text a human sends to a worker SHALL be recorded on that worker's ticket, attributed to the human,
before any attempt is made to deliver it. The record SHALL be made whether the text is delivered
mid-turn or queued, and SHALL be made even when delivery fails.

The recorded text SHALL be the text the human sent, and SHALL be attributed as coming from a human
rather than from an agent or from the system.

#### Scenario: A message delivered mid-turn

- **WHEN** a human sends text that is delivered to the executing turn
- **THEN** that text is on the ticket, attributed to the human

#### Scenario: A message that could not be delivered

- **WHEN** a human sends text and delivery to the running turn fails
- **THEN** the text is still on the ticket, attributed to the human, and is queued for the next turn

#### Scenario: An agent with no ticket

- **WHEN** a human sends text to an agent that has no ticket
- **THEN** the send is refused with a reason rather than silently accepted and unrecorded

### Requirement: What the human types appears in the agent's transcript

Text a human sends to an agent SHALL be recorded as an event in the agent's run, carrying the text,
the fact that a human sent it, and which delivery occurred. It SHALL appear in the live view and in
the stored transcript of that run, and SHALL therefore be visible to whatever can already read a run
— including the conductor's inspection of that run.

#### Scenario: The transcript shows the human's message

- **WHEN** a human sends text to an agent
- **THEN** an entry appears in that run's transcript carrying the text, attributed to the human, and
  saying whether it was delivered mid-turn or queued

#### Scenario: The conductor can see it afterwards

- **WHEN** the conductor inspects a run into which a human sent text
- **THEN** that text is in the transcript it receives

### Requirement: A human message is instruction, never authorisation

Sending text to an agent SHALL NOT change what that agent is permitted to do. The agent's charter,
its permission mode and its allowed and denied tools SHALL be exactly what they were before the text
arrived, and the system SHALL NOT issue any instruction to the runtime that alters them as part of
delivering input.

A human message SHALL NOT count as an answer to an open decision and SHALL NOT satisfy an approval
gate. A decision that was open before the message SHALL still be open after it.

#### Scenario: Permissions are unchanged by a message

- **WHEN** a human sends text to a running agent
- **THEN** the agent's permission mode and its allowed and denied tools are unchanged, and no
  instruction altering them is sent to the runtime

#### Scenario: A message does not answer a decision

- **WHEN** a human sends text to an agent that has an open decision awaiting an answer
- **THEN** the decision remains open and unanswered, and the message is recorded as a message

#### Scenario: A message does not approve

- **WHEN** a human sends text to an agent whose work is waiting on an approval
- **THEN** the approval is not granted by that message
