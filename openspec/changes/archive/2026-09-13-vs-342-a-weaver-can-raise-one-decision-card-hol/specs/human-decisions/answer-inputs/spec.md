## MODIFIED Requirements

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

## ADDED Requirements

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
