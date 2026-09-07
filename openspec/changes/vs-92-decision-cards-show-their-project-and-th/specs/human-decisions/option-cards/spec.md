## MODIFIED Requirements

### Requirement: A decision with options is presented as a card

A decision awaiting the human SHALL be presented as a card showing the question, the context or recommendation behind it, and each of its options with its label and, when there is one, what that option means. An option the asker recommended SHALL be marked as such.

When the decision permits an answer in the human's own words, the card SHALL offer that as an alternative alongside the options. When it does not, the card SHALL offer only its options.

A card SHALL show what the decision is attached to — the ticket it concerns, when it concerns one — and SHALL say who is asking, distinguishing a question raised by the conductor from one raised by a worker.

A card SHALL also always say which project the decision belongs to. A decision that concerns a ticket belongs to that ticket's project. A decision that concerns no ticket belongs to the project the asker named when raising it, or, when the asker named none and works on one project, to that project. A decision that belongs to no project SHALL be labelled as belonging to the workspace rather than left unlabelled, so that a card with no project label can never be read as a card whose project is merely unknown.

The project label SHALL be shown on every surface that offers the card, and SHALL NOT be displaced by anything else the card has to show about what it concerns.

#### Scenario: A question with options

- **WHEN** a decision carrying two or more options is shown to the human
- **THEN** the card shows the question and every option, each exactly once, with the recommended option marked

#### Scenario: An answer in the human's own words is allowed

- **WHEN** a decision allows an answer that is not one of its options
- **THEN** the card offers a way to write an answer as well as the options

#### Scenario: An answer in the human's own words is not allowed

- **WHEN** a decision requires one of its options
- **THEN** the card offers no way to write a different answer

#### Scenario: Who is asking

- **WHEN** the conductor raised the question
- **THEN** the card attributes it to the conductor rather than to a worker

#### Scenario: A decision about a ticket

- **WHEN** a decision concerning a ticket is shown to the human
- **THEN** the card names the project that ticket belongs to

#### Scenario: A decision the asker attached to a project

- **WHEN** the conductor raises a decision that concerns no ticket and names a project
- **THEN** the card names that project

#### Scenario: A decision that belongs to no project

- **WHEN** a decision concerns no ticket and no project was named or implied
- **THEN** the card says the decision belongs to the workspace

#### Scenario: The same label everywhere

- **WHEN** the same decision is offered in the conductor chat, in `Needs you` and on its ticket
- **THEN** every one of them shows the same project label

### Requirement: An answer from a card reaches the asker

An answer sent from a card SHALL be recorded against that decision exactly as an answer given any other way, and the agent that asked the question SHALL be woken with it, so that answering by card and answering in prose have the same consequences.

When the card collected values as well as a choice, those values SHALL travel with the answer: they SHALL be recorded against the decision and SHALL be part of what the asker is woken with, so that the asker never has to read the values out of the conversation.

#### Scenario: The conductor is told

- **WHEN** the human answers a conductor question from a card
- **THEN** the answer is recorded against that decision and the conductor is woken with it

#### Scenario: An answer that is refused

- **WHEN** an answer cannot be recorded — the decision has already been answered, withdrawn or superseded
- **THEN** the human is told, and the card reflects the decision's real state rather than claiming the answer was taken

#### Scenario: The values come with the answer

- **WHEN** the human answers a card that collected values as well as a choice
- **THEN** the recorded answer carries those values and the asker is woken with them
