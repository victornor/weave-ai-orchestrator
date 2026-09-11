## MODIFIED Requirements

### Requirement: Text that cannot be delivered mid-turn is queued for the agent's next turn

Where the runtime does not support mid-turn input, where no turn is executing, or where the executing
turn can no longer receive input, the system SHALL queue the human's text and deliver it at the start
of the agent's next turn, exactly as a message to an idle agent is delivered today — **except** when
the sender is a human, the send asks for live delivery, and a turn is currently executing on a
runtime that does not support mid-turn input. In that case the system SHALL interrupt the executing
turn and deliver the text via the agent's next turn instead of queuing it behind the one that is
running.

Text SHALL NEVER be discarded. Every send SHALL end in exactly one of three outcomes — mid-turn
delivery, an interrupt, or a queued delivery — and SHALL NOT end in none of them.

Interrupting SHALL be available only for a human's send. A message sent on the system's behalf or
another agent's behalf SHALL continue to queue behind a running turn on a runtime without mid-turn
input, exactly as before this change, regardless of whether that send asks for live delivery.

#### Scenario: The agent is between turns

- **WHEN** a human sends text to an agent that has no turn executing
- **THEN** the text is queued and delivered at the start of that agent's next turn

#### Scenario: The turn ends as the text is sent

- **WHEN** a human sends text at the moment the executing turn stops being able to receive input
- **THEN** the text is queued for the next turn rather than lost, and is delivered exactly once

#### Scenario: A runtime with no mid-turn input

- **WHEN** a human sends text to an agent on a runtime that does not support mid-turn input, and no
  turn is executing for that agent
- **THEN** the text is queued for the next turn and the outcome is reported as queued

#### Scenario: A human's live message interrupts a running turn on a runtime with no mid-turn input

- **WHEN** a human sends a live message to an agent whose turn is executing on a runtime that does
  not support mid-turn input
- **THEN** the running turn is interrupted, the text is delivered to the agent's next turn, and the
  outcome is reported as interrupted

#### Scenario: A non-human sender does not interrupt

- **WHEN** a message is sent on the system's behalf or another agent's behalf to an agent whose turn
  is executing on a runtime that does not support mid-turn input
- **THEN** the running turn is left alone and the text is queued for the agent's next turn, exactly
  as before this change

### Requirement: The human is told which delivery happened

Every send SHALL report its outcome to the human as mid-turn delivery, an interrupt, or queued
delivery. The interface SHALL show that outcome for the message that was just sent, and SHALL NOT
report an outcome other than the one that occurred.

#### Scenario: Mid-turn delivery is shown as such

- **WHEN** the human's text is delivered to the executing turn
- **THEN** the interface tells the human it reached the running turn

#### Scenario: Interrupt delivery is shown as such

- **WHEN** the human's text interrupts the executing turn
- **THEN** the interface tells the human it interrupted the running turn and will be answered once
  the agent's next turn starts

#### Scenario: Queued delivery is shown as such

- **WHEN** the human's text is queued
- **THEN** the interface tells the human it will be delivered at the start of the agent's next turn

### Requirement: An attached view states which delivery will happen before the human types

The surface that attaches to one agent SHALL label its input from that agent's live-input status as soon as the status is known and before the human types. Where the status reports mid-turn delivery, the label SHALL say the message reaches the running turn. Where the status reports that a live send would interrupt the running turn, the label SHALL say sending now interrupts the running turn and that the agent answers once its next turn starts. Where the status reports queued delivery, the label SHALL say the message queues for the agent's next turn and SHALL include the reason the status supplies when one is supplied.

The wording SHALL be the same as the wording another surface uses for the same fact, and SHALL NOT invent a third phrasing beyond the three named above. While the status has not yet been fetched, the surface SHALL show no label and SHALL NOT imply any of the three outcomes. When the agent starts or finishes a turn, the surface SHALL update the label from the refreshed status; it SHALL NOT poll the daemon solely to keep the label current.

The label SHALL NOT replace the after-send delivery notice: what will happen before sending and what did happen after sending are both shown.

#### Scenario: The label says mid-turn delivery is available

- **WHEN** a human opens an attached view for an agent whose live-input status reports that input reaches the running turn
- **THEN** the view labels its input as reaching the running turn, in the wording another surface uses for that fact

#### Scenario: The label says a live send would interrupt

- **WHEN** a human opens an attached view for an agent whose turn is executing on a runtime without mid-turn input
- **THEN** the view labels its input as interrupting the running turn if sent now, in the wording another surface uses for that fact

#### Scenario: The label says queued, with the reason supplied

- **WHEN** a human opens an attached view for an agent whose live-input status reports queued delivery and names a reason
- **THEN** the view labels its input as queued for the next turn and includes that reason

#### Scenario: The label says queued when no reason is supplied

- **WHEN** an agent's live-input status reports queued delivery without a reason
- **THEN** the view labels its input as queued for the next turn without inventing a reason

#### Scenario: No label before the status is known

- **WHEN** an attached view is open and its first fetch of the agent's detail has not yet resolved
- **THEN** the view shows no label implying any of the three outcomes

#### Scenario: The label follows a turn starting or ending

- **WHEN** an attached agent starts or finishes a turn and the view refreshes from that event
- **THEN** the input label reflects the newly fetched live-input status

#### Scenario: The label does not add polling

- **WHEN** an attached view is idle and nothing about its agent changes
- **THEN** it makes no request solely to keep the input label current

#### Scenario: The after-send notice is unchanged

- **WHEN** a human sends text from the attached view
- **THEN** the delivery notice states which delivery occurred, exactly as it did before this change

## ADDED Requirements

### Requirement: An interrupt caused by a live message is recorded distinguishably

The system SHALL record a turn interrupted to deliver a live human message in a way that is
distinguishable, on the run itself, both from a failure and from an interrupt caused by something
other than a live message (a daemon shutdown, a human cancelling the run outright). A human or the
conductor reading the run's own record SHALL be able to tell these apart without cross-referencing
another record.

#### Scenario: A message-caused interrupt is not a failure

- **WHEN** a turn is interrupted to deliver a live human message
- **THEN** the run's status records that it was interrupted, not that it failed, exactly as any other
  interrupt is recorded today

#### Scenario: A message-caused interrupt is distinguishable from a daemon shutdown

- **WHEN** a turn is interrupted to deliver a live human message, and separately a turn is interrupted
  by a daemon shutdown or a plain run cancellation
- **THEN** the two runs' own records differ in a way that identifies which kind of interrupt each one
  was, without consulting anything beyond the run

### Requirement: The resumed turn is told it was interrupted and receives the message

Where a turn was interrupted to deliver a live human message, the agent's next turn SHALL be told
that its previous turn was interrupted for this reason, before it does anything else, and SHALL
receive the message that caused the interrupt at the same length the system already gives a human's
own words elsewhere (not the short length a routine "why you were woken" line is cut to for other
wake sources). A message longer than that bound SHALL be marked as cut, with its real length named,
and SHALL remain readable in full through the same place the system already keeps a human message
to a worker in full.

#### Scenario: The resumed turn sees the interrupt and the message

- **WHEN** an agent's turn was interrupted to deliver a live human message and its next turn starts
- **THEN** that turn's prompt states that the previous turn was interrupted to deliver a message, and
  includes that message at the bound the system gives a human's own words elsewhere

#### Scenario: A message past the bound is marked, not silently cut

- **WHEN** the message that caused the interrupt is longer than that bound
- **THEN** the resumed turn's copy of it is marked as cut, its real length is named, and the full
  message remains readable in full through the same place the system already keeps it
