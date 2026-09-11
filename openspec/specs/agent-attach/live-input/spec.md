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

### Requirement: A live-input send refuses an agent that has retired

The system SHALL refuse to send text to an agent that has retired, with a clear error naming that it
has retired, rather than recording the text and queuing it for a turn that will never happen.

#### Scenario: Sending to a retired agent

- **WHEN** a human or the conductor sends text to an agent that has already retired
- **THEN** the send is refused with a clear reason, and nothing is recorded as delivered or queued

#### Scenario: A live agent is unaffected

- **WHEN** a human or the conductor sends text to an agent that has not retired
- **THEN** the send proceeds exactly as it does today, mid-turn or queued

### Requirement: An attached view states which delivery will happen before the human types

The surface that attaches to one agent SHALL label its input from that agent's live-input status as soon as the status is known and before the human types. Where the status reports mid-turn delivery, the label SHALL say the message reaches the running turn. Where the status reports queued delivery, the label SHALL say the message queues for the agent's next turn and SHALL include the reason the status supplies when one is supplied.

The wording SHALL be the same as the wording another surface uses for the same fact, and SHALL NOT invent a third phrasing. While the status has not yet been fetched, the surface SHALL show no label and SHALL NOT imply either outcome. When the agent starts or finishes a turn, the surface SHALL update the label from the refreshed status; it SHALL NOT poll the daemon solely to keep the label current.

The label SHALL NOT replace the after-send delivery notice: what will happen before sending and what did happen after sending are both shown.

#### Scenario: The label says mid-turn delivery is available

- **WHEN** a human opens an attached view for an agent whose live-input status reports that input reaches the running turn
- **THEN** the view labels its input as reaching the running turn, in the wording another surface uses for that fact

#### Scenario: The label says queued, with the reason supplied

- **WHEN** a human opens an attached view for an agent whose live-input status reports queued delivery and names a reason
- **THEN** the view labels its input as queued for the next turn and includes that reason

#### Scenario: The label says queued when no reason is supplied

- **WHEN** an agent's live-input status reports queued delivery without a reason
- **THEN** the view labels its input as queued for the next turn without inventing a reason

#### Scenario: No label before the status is known

- **WHEN** an attached view is open and its first fetch of the agent's detail has not yet resolved
- **THEN** the view shows no label implying either delivery outcome

#### Scenario: The label follows a turn starting or ending

- **WHEN** an attached agent starts or finishes a turn and the view refreshes from that event
- **THEN** the input label reflects the newly fetched live-input status

#### Scenario: The label does not add polling

- **WHEN** an attached view is idle and nothing about its agent changes
- **THEN** it makes no request solely to keep the input label current

#### Scenario: The after-send notice is unchanged

- **WHEN** a human sends text from the attached view
- **THEN** the delivery notice states which delivery occurred, exactly as it did before this change
