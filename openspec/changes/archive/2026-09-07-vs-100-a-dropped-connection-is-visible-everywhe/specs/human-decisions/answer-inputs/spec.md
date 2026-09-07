## MODIFIED Requirements

### Requirement: A secret input's value is never the answer

The value the human supplies for a secret input SHALL be registered as a workspace secret under the name the asker gave for that input, and only that name SHALL be recorded as the input's value. The value itself SHALL NOT appear in the decision, in the answer, in what the asker is woken with, in the conversation, on any ticket, in any activity or event record, in any run transcript or log, or in an export of the workspace.

Registering the secret SHALL happen before the answer is recorded, so that an answer is never recorded for a value the daemon failed to keep. When registration fails, the answer SHALL be refused and the decision SHALL stay open.

A card carrying a secret input SHALL be sent to the daemon directly and SHALL NOT be held in any client-side queue of unsent writes. When it cannot be sent, the human SHALL be told it was not sent and SHALL be able to send it again.

A card carrying no secret input, on any surface that presents decision cards, SHALL instead be
held in the client-side queue of unsent writes when it cannot be sent because the surface cannot
reach the daemon, and SHALL be delivered automatically once the surface reconnects — the human
SHALL NOT have to notice the failure and resend it by hand.

The description of the asking tool SHALL state that a secret input's value is stored rather than answered, so that an agent has no reason to ask for a credential in prose instead.

#### Scenario: A credential supplied on a card

- **WHEN** the human sends a card carrying a secret input with a value
- **THEN** the value is registered as a workspace secret under the asker's name for it, and the recorded value for that input is that name

#### Scenario: The value is nowhere else

- **WHEN** a secret has been supplied on a card
- **THEN** the value appears in no decision, comment, message, activity record, event, transcript, log or export

#### Scenario: The store refuses the value

- **WHEN** registering the supplied secret fails
- **THEN** the answer is refused, the decision stays open, and no answer is recorded

#### Scenario: A secret is not queued while offline

- **WHEN** the human sends a card carrying a secret input and the send fails
- **THEN** nothing is queued for later and the human is told it was not sent

#### Scenario: A non-secret answer is queued, on whichever surface presented the card

- **WHEN** the human answers a card carrying no secret input from any surface that presents
  decision cards, and the surface cannot reach the daemon
- **THEN** the answer is held in the client-side queue and sent automatically once the surface
  reconnects, without the human resending it
