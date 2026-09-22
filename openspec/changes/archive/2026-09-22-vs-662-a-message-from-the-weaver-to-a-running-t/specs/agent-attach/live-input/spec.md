## MODIFIED Requirements

### Requirement: Text that cannot be delivered mid-turn is queued for the agent's next turn

Where the runtime does not support mid-turn input, where no turn is executing, or where the executing turn can no longer receive input, the system SHALL queue the human's text and deliver it at the start of the agent's next turn, exactly as a message to an idle agent is delivered today — **except** when the text is a steer to a ticket-bound worker whose turn is executing, which `worker-supervision/running-worker-steering` governs: it SHALL be delivered into the running turn where that turn has an open mid-turn channel, and otherwise SHALL interrupt the turn and resume the same session with the text.

Text SHALL NEVER be discarded. Every send SHALL end in exactly one of three outcomes — mid-turn delivery, an interrupt, or a queued delivery — and SHALL NOT end in none of them.

A message sent on the system's behalf SHALL continue to queue behind a running turn on a runtime without mid-turn input, exactly as before this change. The conductor's steer and a human's message or comment to a ticket-bound worker are governed by `worker-supervision/running-worker-steering`, and the ticketless-session behaviour is unchanged.

#### Scenario: The agent is between turns

- **WHEN** a human sends text to an agent that has no turn executing
- **THEN** the text is queued and delivered at the start of that agent's next turn

#### Scenario: The turn ends as the text is sent

- **WHEN** a human sends text at the moment the executing turn stops being able to receive input
- **THEN** the text is queued for the next turn rather than lost, and is delivered exactly once

#### Scenario: A runtime with no mid-turn input

- **WHEN** a human sends text to an agent on a runtime that does not support mid-turn input, and no turn is executing for that agent
- **THEN** the text is queued for the next turn and the outcome is reported as queued

#### Scenario: A human's live message interrupts a running turn on a runtime with no mid-turn input

- **WHEN** a human sends a live message to an agent whose turn is executing on a runtime that does not support mid-turn input
- **THEN** the running turn is interrupted, the text is delivered to the agent's next turn, and the outcome is reported as interrupted

#### Scenario: A non-human sender does not interrupt

- **WHEN** a message is sent on the system's behalf — not the conductor's steer, which `worker-supervision/running-worker-steering` governs — to an agent whose turn is executing on a runtime that does not support mid-turn input
- **THEN** the running turn is left alone and the text is queued for the agent's next turn, exactly as before this change

#### Scenario: A human's message to a running ticket worker is never queued

- **WHEN** a human sends a message to a ticket-bound worker whose turn is executing, on a runtime whose turn has an open mid-turn channel
- **THEN** the message is delivered into that turn, and the outcome is reported as mid-turn delivery rather than as a queue

#### Scenario: The conductor's steer follows the running-worker rule

- **WHEN** the conductor steers a running ticket-bound worker
- **THEN** whether that send interrupts is governed by `worker-supervision/running-worker-steering`, not by this requirement's carve-out for human messages