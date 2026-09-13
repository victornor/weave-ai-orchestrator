# human-decisions/answer-inputs Specification

## Purpose
Defines what an agent may ask the human to supply on a decision card beyond choosing an option — free text, a longer note, several choices at once, or a credential — so that a question needing a value is answered in one gesture on the card, and a credential the human supplies never becomes part of the conversation.

## Requirements

### Requirement: An asker can ask for values as well as a choice

An agent raising a decision SHALL be able to attach a list of inputs to it, each with a key that is
unique within that decision, a label the human reads, and a type. The supported types SHALL be a
single line of text, a multi-line note, a single choice from a list of choices the asker supplies, a
selection of several items from a list of choices the asker supplies, and a secret. Every input MAY
also carry a short description shown under its label, and a default value.

An input MAY be marked required. An input of the single-choice type SHALL carry the choices it
selects from — at least two of them, each with its own key and label — and MAY allow an answer in the
human's own words as well as those choices. An input of the multi-select type SHALL carry at least
one choice. A choice the asker recommends, and a single-choice or multi-select default, SHALL each
be one of that input's choices; a choice it does not offer, or a default that is not among them,
SHALL make the decision be refused when it is raised.

An input of the secret type SHALL carry the name the supplied value is to be stored under; a secret
input without one SHALL be rejected when the decision is raised. A secret input SHALL NOT carry a
default.

Inputs SHALL be independent of options: a decision MAY carry inputs and options, inputs alone, or
options alone.

A decision that carries no inputs SHALL behave in every respect as it does without this capability —
the same card, the same actions, the same recorded answer.

#### Scenario: A question that needs a value

- **WHEN** an agent raises a decision with a text input
- **THEN** the decision is created carrying that input

#### Scenario: A single-choice question

- **WHEN** an agent raises a decision with a single-choice input carrying two or more choices, one of
  them recommended
- **THEN** the decision is created carrying that input, its choices and its recommendation

#### Scenario: A single-choice with fewer than two choices

- **WHEN** an agent raises a decision with a single-choice input carrying fewer than two choices
- **THEN** the decision is refused and the reason names the input

#### Scenario: A recommended choice that is not offered

- **WHEN** an agent raises a decision whose input recommends a choice that is not one of its choices
- **THEN** the decision is refused and the reason names the input

#### Scenario: A default that is not a choice

- **WHEN** an agent raises a decision whose single-choice or multi-select input defaults to a key it
  does not offer
- **THEN** the decision is refused and the reason names the input

#### Scenario: A multi-select without choices

- **WHEN** an agent raises a decision with a multi-select input and no choices
- **THEN** the decision is refused and the reason names the input

#### Scenario: A secret input without a name to store it under

- **WHEN** an agent raises a decision with a secret input that names no secret
- **THEN** the decision is refused and the reason names the input

#### Scenario: Two inputs with the same key

- **WHEN** an agent raises a decision whose inputs repeat a key
- **THEN** the decision is refused

#### Scenario: A decision with no inputs

- **WHEN** a decision carrying no inputs is raised and answered
- **THEN** it is created, shown and recorded exactly as it is without this capability

### Requirement: A card renders its inputs and will not send until they are satisfied

A card for a decision carrying inputs SHALL render a control for each input, in the order the asker
gave them, labelled as the asker labelled it and showing the asker's description, when there is one,
under that label. A single-line text input SHALL take one line, a multi-line input SHALL take
several, a single-choice input SHALL offer every choice and allow exactly one to be selected and
another to replace it, a multi-select SHALL offer every choice and allow any number of them to be
selected and deselected, and a secret SHALL take a value that is masked as it is typed and is never
displayed back.

A choice the asker recommended SHALL be shown as pre-selected, and an input carrying a default SHALL
be shown pre-filled with it, so that a question with a recommendation can be sent without the human
first touching it. A single-choice input that allows an answer in the human's own words SHALL offer
that alternative, and choosing it SHALL take the text the human types as the answer to that question.

The card's send action SHALL be unavailable while any required input is empty, and the card SHALL say
which input is still needed. An optional input left empty SHALL NOT block the send.

An answered card SHALL show the values that were recorded rather than the controls, each labelled
with the asker's label, and a secret input SHALL be shown as the name it was stored under, never as a
value.

#### Scenario: Rendering the inputs

- **WHEN** a card for a decision with three inputs of different types is shown
- **THEN** it shows one control per input, in the asker's order, each with the asker's label and
  description

#### Scenario: A recommended choice is pre-selected

- **WHEN** a card shows a single-choice input whose asker recommended one of its choices
- **THEN** that choice is shown as selected before the human touches anything

#### Scenario: A default is pre-filled

- **WHEN** a card shows a text input or a multi-select input carrying a default
- **THEN** the control is shown holding that default

#### Scenario: The free-form alternative

- **WHEN** a single-choice input allows an answer in the human's own words and the human chooses that
  alternative
- **THEN** the card takes the text they type as the answer to that question

#### Scenario: A required input is empty

- **WHEN** a required input has no value
- **THEN** the card does not offer to send the answer and says which input is needed

#### Scenario: A required input is filled

- **WHEN** every required input has a value
- **THEN** the card offers to send the answer

#### Scenario: Selecting several choices

- **WHEN** the human selects two choices of a multi-select and then deselects one
- **THEN** the remaining choice is the one selected and the decision is still unanswered

#### Scenario: Changing a single-choice selection

- **WHEN** the human selects one choice of a single-choice input and then another before sending
- **THEN** the second choice is the one selected and the decision is still unanswered

#### Scenario: A secret is not shown

- **WHEN** the human types into a secret input
- **THEN** the characters are masked and the value is never rendered back

#### Scenario: An answered card with inputs

- **WHEN** a card shows a decision that was answered with input values
- **THEN** it shows those values as a record and offers no controls, and a secret is shown as the name it was stored under

### Requirement: The values reach the asker keyed by input

Sending an answer from a card carrying inputs SHALL record the collected values against the decision as a map keyed by the input's key, and the asker SHALL be woken with that map. A value for a single-line, multi-line or secret input SHALL be recorded as a string; a value for a multi-select SHALL be recorded as the list of chosen keys, in the order the choices were offered; a value for a single-choice input SHALL be recorded as the key of the chosen choice, or as the text the human typed when they chose the free-form alternative.

An optional input the human left empty SHALL be absent from the map rather than present and empty. A value for a key the decision does not declare SHALL be refused, a selection that is not one of the multi-select's choices SHALL be refused, and a single-choice value that is neither one of its choices nor, when it allows one, the human's own words SHALL be refused; in every case nothing SHALL be recorded and the decision SHALL stay open.

Values submitted for a decision that carries no inputs SHALL be refused.

#### Scenario: Text and a choice together

- **WHEN** the human sends a card with an option selected and a text input filled
- **THEN** the recorded answer carries both the option and the value under its input's key

#### Scenario: A multi-select answer

- **WHEN** the human sends a card having selected two of a multi-select's choices
- **THEN** the recorded value for that input is the list of the two chosen keys

#### Scenario: A single-choice answer

- **WHEN** the human sends a card having selected one of a single-choice input's choices
- **THEN** the recorded value for that input is that choice's key

#### Scenario: A single-choice answer in the human's own words

- **WHEN** the human sends a card having chosen a single-choice input's free-form alternative and typed an answer
- **THEN** the recorded value for that input is the text they typed

#### Scenario: A single-choice value that was not offered

- **WHEN** an answer gives a single-choice input a value that is not one of its choices and it does
  not allow a free-form answer
- **THEN** the answer is refused and the decision stays open

#### Scenario: An empty optional input

- **WHEN** the human sends a card leaving an optional input empty
- **THEN** that key is absent from the recorded values

#### Scenario: A value for an input that does not exist

- **WHEN** an answer carries a value under a key the decision does not declare
- **THEN** the answer is refused and the decision stays open

#### Scenario: A choice that was not offered

- **WHEN** an answer selects a multi-select value that is not one of its choices
- **THEN** the answer is refused and the decision stays open

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

### Requirement: A surface that cannot collect a value safely says so

A surface that renders decision cards but cannot collect the inputs — because it has no controls for them, or because it cannot take a secret without putting it in a message — SHALL show the decision as a question to be answered in the web app rather than offering an answer it cannot complete.

#### Scenario: A card with inputs on a chat channel

- **WHEN** a decision carrying inputs is rendered on a channel that cannot collect them
- **THEN** the card is shown with its question and says the answer is to be given in the web app

#### Scenario: A card without inputs on a chat channel

- **WHEN** a decision carrying no inputs is rendered on the same channel
- **THEN** it is offered with its options exactly as it is today

### Requirement: A card can hold several questions and answer them in one send

A decision MAY carry several inputs, each standing as a question the asker needs answered. A card
carrying several SHALL render every one of them together and SHALL be answerable in one send, with
every required question enforced before the send is offered. Sending it SHALL record a value for
each input the human supplied and SHALL wake the asker with the map, exactly as for a card carrying
one input. An answered card carrying several SHALL show each question with the answer it was given.

A question the asker recommended a default for SHALL NOT stand in the way of sending the card once
every required question is satisfied.

#### Scenario: Several questions on one card

- **WHEN** an agent raises a decision whose inputs are four single-choice questions
- **THEN** one card shows all four questions, in the asker's order, each with its own choices

#### Scenario: Answering several questions in one send

- **WHEN** the human answers a card carrying several questions and sends it once
- **THEN** every answer is recorded against the decision and the asker is woken with them together

#### Scenario: A required question blocks the send

- **WHEN** one of several questions is required and has no answer
- **THEN** the card does not offer to send and says which question is needed

#### Scenario: The answered card shows each answer

- **WHEN** a card carrying several questions has been answered
- **THEN** it shows each question with the answer it was given, and no controls
