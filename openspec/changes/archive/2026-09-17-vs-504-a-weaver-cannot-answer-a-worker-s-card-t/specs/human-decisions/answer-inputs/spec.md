## MODIFIED Requirements

### Requirement: The values reach the asker keyed by input

Sending an answer from a card carrying inputs SHALL record the collected values against the decision as a map keyed by the input's key, and the asker SHALL be woken with that map. A value for a single-line, multi-line or secret input SHALL be recorded as a string; a value for a multi-select SHALL be recorded as the list of chosen keys, in the order the choices were offered; a value for a single-choice input SHALL be recorded as the key of the chosen choice, or as the text the human typed when they chose the free-form alternative.

An agent answering a decision it owns SHALL be able to submit the same keyed input-value map. The agent answer path SHALL use the same required-input, declared-key, single-choice, multi-select and secret handling as a card answer, and SHALL record the resulting `answerInputs` map and wake the asker with it.

An optional input the human or agent left empty SHALL be absent from the map rather than present and empty. A value for a key the decision does not declare SHALL be refused, a selection that is not one of the multi-select's choices SHALL be refused, and a single-choice value that is neither one of its choices nor, when it allows one, the human's own words SHALL be refused; in every case nothing SHALL be recorded and the decision SHALL stay open.

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

- **WHEN** an answer gives a single-choice input a value that is not one of its choices and it does not allow a free-form answer
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

#### Scenario: A weaver answers a worker's required questions

- **WHEN** the weaver answers a weaver-owned decision carrying two required single-choice inputs with the keys of the selected choices
- **THEN** the decision is answered, its `answerInputs` contains both keyed selections, and the asking worker is woken with the same map

#### Scenario: A weaver omits a required question

- **WHEN** the weaver answers an input-bearing decision without a value for one of its required inputs
- **THEN** the answer is refused with the missing input named and the decision stays open

#### Scenario: A weaver selects a choice that was not offered

- **WHEN** the weaver answers a single-choice input with a key that is not one of that input's declared choices and the input does not allow a free-form answer
- **THEN** the answer is refused with the input and invalid key named and the decision stays open
